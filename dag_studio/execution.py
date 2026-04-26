"""Workflow validation and node execution for DAGBoard."""

from __future__ import annotations

import math
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

import numpy as np

from dag_studio.baselines import get_algorithm_metadata, run_official_baseline
from dag_studio.graph_utils import binary_adjacency, edge_list_from_matrix, graph_nodes, overlay_edges
from dag_studio.metrics import MetricsCalculator, sid_score
from dag_studio.node_types import NODE_TYPES
from dag_studio.schemas import NodeRunRecord, WorkflowDefinition, WorkflowEdge, WorkflowNode
from dag_studio.simulation import is_dag, set_random_seed, simulate_dag, simulate_parameter, simulate_sem
from dag_studio.storage import LocalStudioStorage, matrix_summary, utc_now


class WorkflowValidationError(ValueError):
    """Raised when a workflow cannot be executed."""


class WorkflowExecutionError(WorkflowValidationError):
    """Raised after a run records node-level failures."""

    def __init__(self, message: str, records: Dict[str, NodeRunRecord]):
        super().__init__(message)
        self.records = records


@dataclass
class NodeContext:
    public: Dict[str, Any]
    arrays: Dict[str, np.ndarray] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)


@dataclass
class GraphLike:
    source: str
    kind: str
    labels: list[str]
    W: np.ndarray
    B: np.ndarray
    scores: np.ndarray
    graph_space: str = "dag"
    port_id: Optional[str] = None


NODE_TYPE_BY_ID = {node_type.id: node_type for node_type in NODE_TYPES}


def _node_params(node: WorkflowNode) -> Dict[str, Any]:
    params = dict(node.data.get("params", {}))
    for key, value in node.data.items():
        if key not in {"params", "label", "status", "nodeType"} and key not in params:
            params[key] = value
    return params


def _has_value(value: Any) -> bool:
    return value is not None and value != ""


def _float_param(params: dict[str, Any], key: str, default: float) -> float:
    value = params.get(key)
    return float(value) if _has_value(value) else default


def _incoming_edges(workflow: WorkflowDefinition) -> dict[str, list[WorkflowEdge]]:
    incoming: dict[str, list[WorkflowEdge]] = {node.id: [] for node in workflow.nodes}
    for edge in workflow.edges:
        if edge.target not in incoming:
            raise WorkflowValidationError(f"Edge targets missing node: {edge.target}")
        if edge.source not in incoming:
            raise WorkflowValidationError(f"Edge sources missing node: {edge.source}")
        incoming[edge.target].append(edge)
    return incoming


def _outgoing_edges(workflow: WorkflowDefinition) -> dict[str, list[WorkflowEdge]]:
    outgoing: dict[str, list[WorkflowEdge]] = {node.id: [] for node in workflow.nodes}
    for edge in workflow.edges:
        if edge.source in outgoing:
            outgoing[edge.source].append(edge)
    return outgoing


def _edge_payload(edge: WorkflowEdge) -> dict:
    return {
        "edge_id": edge.id or f"{edge.source}->{edge.target}",
        "source": edge.source,
        "target": edge.target,
        "source_handle": edge.source_handle,
        "target_handle": edge.target_handle,
    }


def upstream_closure(workflow: WorkflowDefinition, target_node_id: str) -> set[str]:
    node_ids = {node.id for node in workflow.nodes}
    if target_node_id not in node_ids:
        raise WorkflowValidationError(f"Target node not found: {target_node_id}")
    incoming = _incoming_edges(workflow)
    closure = {target_node_id}
    stack = [target_node_id]
    while stack:
        node_id = stack.pop()
        for edge in incoming[node_id]:
            if edge.source not in closure:
                closure.add(edge.source)
                stack.append(edge.source)
    return closure


def topological_order(workflow: WorkflowDefinition) -> list[str]:
    node_ids = {node.id for node in workflow.nodes}
    if len(node_ids) != len(workflow.nodes):
        raise WorkflowValidationError("Workflow contains duplicate node ids.")

    indegree = {node_id: 0 for node_id in node_ids}
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in workflow.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise WorkflowValidationError("Workflow contains an edge with a missing endpoint.")
        if edge.source == edge.target:
            raise WorkflowValidationError("Workflow edges cannot be self-loops.")
        outgoing[edge.source].append(edge.target)
        indegree[edge.target] += 1

    ready = sorted([node_id for node_id, degree in indegree.items() if degree == 0])
    order: list[str] = []
    while ready:
        node_id = ready.pop(0)
        order.append(node_id)
        for target in outgoing[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
                ready.sort()

    if len(order) != len(node_ids):
        raise WorkflowValidationError("Workflow contains a cycle.")
    return order


def _artifact_refs_from_public(value: Any) -> list[dict]:
    refs: list[dict] = []

    def walk(item: Any) -> None:
        if isinstance(item, dict):
            if "artifact_id" in item and "kind" in item:
                refs.append(
                    {
                        "artifact_id": item.get("artifact_id"),
                        "kind": item.get("kind"),
                        "path": item.get("path"),
                        "output_kind": item.get("output_kind"),
                    }
                )
            for child in item.values():
                walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)

    walk(value)
    deduped: list[dict] = []
    seen: set[str] = set()
    for ref in refs:
        key = str(ref.get("artifact_id") or ref.get("path"))
        if key not in seen:
            seen.add(key)
            deduped.append(ref)
    return deduped


def _context_kinds(context: NodeContext) -> set[str]:
    kind = str(context.public.get("kind", ""))
    kinds = {kind} if kind else set()
    if kind in {"graph", "data", "algorithm_result"}:
        kinds.add("graph")
        kinds.add("graph_like")
    return kinds


def _linear_gaussian_bic(X: np.ndarray, B: np.ndarray) -> dict[str, float]:
    """Score a graph against data using local linear Gaussian regressions."""

    X = np.asarray(X, dtype=float)
    B = np.asarray(B, dtype=int)
    n_samples, n_features = X.shape
    if B.shape != (n_features, n_features):
        raise WorkflowValidationError(
            f"BIC graph/data shape mismatch: graph has shape {B.shape}, data has {n_features} features."
        )
    log_likelihood = 0.0
    num_params = 0
    for target in range(n_features):
        parents = np.flatnonzero(B[:, target] != 0)
        y = X[:, target]
        if parents.size:
            design = np.column_stack([np.ones(n_samples), X[:, parents]])
        else:
            design = np.ones((n_samples, 1))
        beta, *_ = np.linalg.lstsq(design, y, rcond=None)
        residual = y - design @ beta
        sigma2 = max(float(np.mean(residual * residual)), 1e-12)
        log_likelihood += -0.5 * n_samples * (math.log(2.0 * math.pi * sigma2) + 1.0)
        num_params += int(parents.size) + 2
    bic = -2.0 * log_likelihood + float(num_params) * math.log(float(n_samples))
    return {
        "bic": float(bic),
        "log_likelihood": float(log_likelihood),
        "num_params": float(num_params),
        "n_samples": float(n_samples),
        "n_features": float(n_features),
    }


LOWER_IS_BETTER_METRICS = {"shd", "bic", "sid", "fdr", "fpr", "dag_error"}


def _metric_sort_direction(metric: str) -> str:
    return "asc" if metric.lower() in LOWER_IS_BETTER_METRICS else "desc"


def _resolve_sort_order(metric: str, sort_order: str) -> str:
    return _metric_sort_direction(metric) if sort_order == "auto" else sort_order


def _matrix_table_preview(matrix: np.ndarray, columns: list[str], rows: int = 12, decimals: int = 4) -> dict[str, Any]:
    arr = np.asarray(matrix, dtype=float)
    row_count = min(max(rows, 0), int(arr.shape[0])) if arr.ndim >= 2 else 0
    col_count = int(arr.shape[1]) if arr.ndim >= 2 else 0
    return {
        "columns": columns[:col_count],
        "row_count": int(arr.shape[0]) if arr.ndim >= 2 else 0,
        "preview_count": row_count,
        "rows": [
            {
                "index": int(index),
                "values": [round(float(value), decimals) for value in arr[index, :col_count]],
            }
            for index in range(row_count)
        ],
    }


def _evaluation_label(source_node_id: str, evaluation: dict[str, Any]) -> str:
    meta = evaluation.get("eval_meta") if isinstance(evaluation.get("eval_meta"), dict) else {}
    for key in ("prediction_source", "graph_source"):
        value = meta.get(key)
        if isinstance(value, str) and value:
            if ":" in value:
                return value.split(":")[-1]
            return value
    return source_node_id


def _finite_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float, np.integer, np.floating)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    return None


class WorkflowExecutor:
    """Execute one workflow into one run directory."""

    def __init__(
        self,
        storage: LocalStudioStorage,
        run_dir: Path,
        emit: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        target_node_id: Optional[str] = None,
        disabled_node_ids: Optional[Iterable[str]] = None,
    ):
        self.storage = storage
        self.run_dir = Path(run_dir)
        self.emit = emit or (lambda _event, _payload: None)
        self.target_node_id = target_node_id
        self.disabled_node_ids = set(disabled_node_ids or [])

    def execute(self, workflow: WorkflowDefinition) -> Dict[str, NodeRunRecord]:
        order = topological_order(workflow)
        node_by_id = {node.id: node for node in workflow.nodes}
        incoming = _incoming_edges(workflow)
        outgoing = _outgoing_edges(workflow)
        execute_set = set(node_by_id)
        if self.target_node_id:
            execute_set = upstream_closure(workflow, self.target_node_id)
        missing_disabled = self.disabled_node_ids - set(node_by_id)
        if missing_disabled:
            raise WorkflowValidationError(f"Disabled node not found: {sorted(missing_disabled)[0]}")
        contexts: dict[str, NodeContext] = {}
        records: dict[str, NodeRunRecord] = {
            node.id: NodeRunRecord(node_id=node.id, node_type=node.type, status="queued")
            for node in workflow.nodes
        }
        failure_message: Optional[str] = None

        for node_id in order:
            node = node_by_id[node_id]
            record = records[node_id]
            input_edges = [_edge_payload(edge) for edge in incoming[node_id]]
            output_edges = [_edge_payload(edge) for edge in outgoing[node_id]]
            if node_id not in execute_set:
                record.status = "skipped"
                record.finished_at = utc_now()
                record.warnings.append("Skipped because it is outside the target node upstream closure.")
                self.emit(
                    "node_skipped",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "reason": "outside_target_closure",
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )
                continue
            if node_id in self.disabled_node_ids or bool(node.data.get("disabled")):
                record.status = "skipped"
                record.finished_at = utc_now()
                record.warnings.append("Skipped because the node is disabled.")
                self.emit(
                    "node_skipped",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "reason": "disabled",
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )
                continue

            missing_inputs = [edge.source for edge in incoming[node_id] if edge.source not in contexts]
            if missing_inputs:
                record.status = "blocked"
                record.finished_at = utc_now()
                record.error = f"Blocked by unavailable upstream nodes: {', '.join(sorted(missing_inputs))}."
                self.emit(
                    "node_blocked",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "blocked_by": sorted(missing_inputs),
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )
                continue

            parents = [contexts[edge.source] for edge in incoming[node_id]]
            validation_error = self._validate_node_inputs(node, parents, incoming[node_id])
            if validation_error:
                record.status = "blocked"
                record.finished_at = utc_now()
                record.error = validation_error
                self.emit(
                    "node_blocked",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "reason": "validation",
                        "error": validation_error,
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )
                continue

            record.status = "running"
            record.started_at = utc_now()
            self.emit(
                "node_started",
                {
                    "node_id": node.id,
                    "node_type": node.type,
                    "input_edges": input_edges,
                    "output_edges": output_edges,
                },
            )
            start = time.perf_counter()
            try:
                context = self._execute_node(node, parents, incoming[node_id])
                contexts[node.id] = context
                record.status = "success"
                record.outputs = context.public
                record.warnings = context.warnings
                record.finished_at = utc_now()
                artifact_refs = _artifact_refs_from_public(context.public)
                duration_ms = (time.perf_counter() - start) * 1000.0
                self.emit(
                    "node_completed",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "outputs": context.public,
                        "warnings": context.warnings,
                        "duration_ms": duration_ms,
                        "artifact_refs": artifact_refs,
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )
                for warning in context.warnings:
                    self.emit(
                        "node_warning",
                        {
                            "node_id": node.id,
                            "node_type": node.type,
                            "warning": warning,
                            "duration_ms": duration_ms,
                        },
                    )
            except Exception as exc:
                record.status = "failed"
                record.error = str(exc)
                record.finished_at = utc_now()
                detail = traceback.format_exc(limit=6)
                failure_message = failure_message or str(exc)
                self.emit(
                    "node_failed",
                    {
                        "node_id": node.id,
                        "node_type": node.type,
                        "error": str(exc),
                        "detail": detail,
                        "duration_ms": (time.perf_counter() - start) * 1000.0,
                        "input_edges": input_edges,
                        "output_edges": output_edges,
                    },
                )

        if failure_message is not None:
            raise WorkflowExecutionError(failure_message, records)

        return records

    def _execute_node(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: Optional[list[WorkflowEdge]] = None,
    ) -> NodeContext:
        if node.type == "structure_generator":
            return self._execute_structure(node)
        if node.type == "data_generator":
            return self._execute_data(node, parents)
        if node.type == "algorithm":
            return self._execute_algorithm(node, parents)
        if node.type == "evaluation":
            return self._execute_evaluation(node, parents, input_edges or [])
        if node.type == "evaluation_summary":
            return self._execute_evaluation_summary(node, parents, input_edges or [])
        if node.type == "graph_view":
            return self._execute_graph_view(node, parents)
        raise WorkflowValidationError(f"Unknown node type: {node.type}")

    def _validate_node_inputs(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
    ) -> Optional[str]:
        definition = NODE_TYPE_BY_ID.get(node.type)
        if definition is None:
            return f"Unknown node type: {node.type}"
        if node.type == "evaluation":
            mode = str(_node_params(node).get("mode", "compare"))
            graph_like_count = sum(1 for parent in parents if "graph_like" in _context_kinds(parent))
            data_count = sum(1 for parent in parents if "data" in _context_kinds(parent))
            handles = {edge.target_handle for edge in input_edges if edge.target_handle}
            if mode == "bic":
                missing: list[str] = []
                if handles:
                    graph_count = sum(
                        1
                        for edge, parent in zip(input_edges, parents)
                        if edge.target_handle in {"graph", "truth_graph", "pred_graph"}
                        and "graph_like" in _context_kinds(parent)
                    )
                else:
                    graph_count = graph_like_count
                if graph_count < 1:
                    missing.append("graph")
                if data_count < 1:
                    missing.append("data")
                if missing:
                    return f"Evaluation BIC mode requires graph + data inputs; missing: {', '.join(missing)}."
                return None

            if handles:
                legacy_truth_pred = {"truth_graph", "pred_graph"} <= handles
                if legacy_truth_pred:
                    missing = []
                    for port_id in ["truth_graph", "pred_graph"]:
                        has_port = any(
                            edge.target_handle == port_id and "graph_like" in _context_kinds(parent)
                            for edge, parent in zip(input_edges, parents)
                        )
                        if not has_port:
                            missing.append(port_id)
                    if missing:
                        return f"Evaluation compare mode requires two graph inputs; missing: {', '.join(missing)}."
                else:
                    graph_count = sum(
                        1
                        for edge, parent in zip(input_edges, parents)
                        if edge.target_handle in {"graph", "truth_graph", "pred_graph"}
                        and "graph_like" in _context_kinds(parent)
                    )
                    if graph_count < 2:
                        return f"Evaluation compare mode requires two graph inputs; missing: graph x{2 - graph_count}."
            elif graph_like_count < 2:
                return f"Evaluation compare mode requires two graph inputs; missing: graph x{2 - graph_like_count}."
            return None

        missing: list[str] = []
        for port in definition.input_ports:
            if not port.required:
                continue
            count = 0
            for edge, parent in zip(input_edges, parents):
                if edge.target_handle and edge.target_handle != port.id:
                    continue
                if port.kind in _context_kinds(parent):
                    count += 1
            if count < port.min_count:
                missing.append(port.id)
        if missing:
            return f"Node requires input ports; missing: {', '.join(missing)}."
        return None

    def _find_parent(self, parents: Iterable[NodeContext], kind: str) -> NodeContext:
        for parent in parents:
            if parent.public.get("kind") == kind:
                return parent
        raise WorkflowValidationError(f"Node requires an input of kind `{kind}`.")

    def _find_optional_parent(self, parents: Iterable[NodeContext], kind: str) -> Optional[NodeContext]:
        for parent in parents:
            if parent.public.get("kind") == kind:
                return parent
        return None

    def _execute_structure(self, node: WorkflowNode) -> NodeContext:
        params = _node_params(node)
        d = int(params.get("d", 8))
        s0 = int(params.get("s0", 12))
        graph_type = str(params.get("graph_type", "ER"))
        seed = params.get("seed")
        weight_ranges = params.get("weight_ranges", [[-2.0, -0.5], [0.5, 2.0]])

        if d <= 1:
            raise WorkflowValidationError("`d` must be greater than 1.")
        if s0 < 0 or s0 > d * (d - 1) // 2:
            raise WorkflowValidationError("`s0` must be between 0 and d*(d-1)/2.")
        if seed is not None:
            set_random_seed(int(seed))

        ranges = [(float(low), float(high)) for low, high in weight_ranges]
        B = simulate_dag(d, s0, graph_type, seed=int(seed) if seed is not None else None)
        W = simulate_parameter(B, ranges, seed=int(seed) if seed is not None else None)
        np.fill_diagonal(W, 0.0)
        B = binary_adjacency(W)
        if not is_dag(W):
            raise WorkflowValidationError("Generated graph is not a DAG.")

        labels = params.get("node_labels") or [f"X{i + 1}" for i in range(d)]
        ref = self.storage.write_npz(
            self.run_dir,
            f"{node.id}_graph",
            node_id=node.id,
            node_type=node.type,
            output_kind="graph",
            adjacency=B,
            weights=W,
        )
        graph = {
            "node_labels": labels,
            "nodes": graph_nodes(labels),
            "edge_list": edge_list_from_matrix(W, labels, threshold=0.0),
            "graph_meta": {
                "graph_space": "dag",
                "d": d,
                "s0": int(np.count_nonzero(B)),
                "graph_type": graph_type,
                "seed": seed,
                "is_dag": True,
            },
            "matrix_summary": {
                "adjacency": matrix_summary(B),
                "weights": matrix_summary(W, ref),
            },
            "matrix_ref": ref,
        }
        graph["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_graph",
            graph,
            node_id=node.id,
            node_type=node.type,
            output_kind="graph",
            summary=graph["graph_meta"],
        )
        return NodeContext(public={"kind": "graph", "graph": graph}, arrays={"B_true": B, "W_true": W})

    def _execute_data(self, node: WorkflowNode, parents: list[NodeContext]) -> NodeContext:
        graph_parent = self._find_parent(parents, "graph")
        params = _node_params(node)
        W = np.asarray(graph_parent.arrays["W_true"], dtype=float)
        B = binary_adjacency(W)
        n_samples = int(params.get("n_samples", 120))
        sem_type = str(params.get("sem_type", "gauss"))
        sem_noise = params.get("sem_noise", 1.0)
        seed = params.get("seed")
        standardize = bool(params.get("standardize", True))
        if n_samples <= 0:
            raise WorkflowValidationError("`n_samples` must be positive.")
        if seed is not None:
            set_random_seed(int(seed))

        if sem_type not in {"gauss", "exp", "gumbel", "uniform", "logistic", "poisson", "mlp", "mim"}:
            raise WorkflowValidationError(f"Unsupported SEM type: {sem_type}")
        X = simulate_sem(W, n_samples, sem_type, float(sem_noise), seed=int(seed) if seed is not None else None)

        warnings: list[str] = []
        if standardize:
            mean = X.mean(axis=0)
            std = X.std(axis=0)
            zero_std = std < 1e-12
            if np.any(zero_std):
                warnings.append("Some columns had zero variance during standardization.")
                std[zero_std] = 1.0
            X = (X - mean) / std
        if not np.isfinite(X).all():
            raise WorkflowValidationError("Generated data contains NaN or infinite values.")

        labels = graph_parent.public["graph"]["node_labels"]
        ref = self.storage.write_npz(
            self.run_dir,
            f"{node.id}_data",
            node_id=node.id,
            node_type=node.type,
            output_kind="data",
            X=X,
            B_true=B,
            W_true=W,
        )
        data = {
            "feature_order": labels,
            "data_meta": {
                "source": "synthetic",
                "n_samples": int(X.shape[0]),
                "n_features": int(X.shape[1]),
                "sem_type": sem_type,
                "sem_noise": sem_noise,
                "seed": seed,
                "standardize": standardize,
            },
            "matrix_summary": {
                "X": matrix_summary(X),
                "B_true": matrix_summary(B),
                "W_true": matrix_summary(W),
            },
            "data_preview": _matrix_table_preview(X, labels),
            "matrix_ref": ref,
        }
        data["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_data",
            data,
            node_id=node.id,
            node_type=node.type,
            output_kind="data",
            summary=data["data_meta"],
        )
        return NodeContext(
            public={"kind": "data", "data": data},
            arrays={"X": X, "B_true": B, "W_true": W},
            warnings=warnings,
        )

    def _execute_algorithm(self, node: WorkflowNode, parents: list[NodeContext]) -> NodeContext:
        data_parent = self._find_parent(parents, "data")
        params = _node_params(node)
        algorithm_id = str(params.get("algorithm_id") if _has_value(params.get("algorithm_id")) else "PC")
        threshold = _float_param(params, "w_threshold", 0.3)
        X = np.asarray(data_parent.arrays["X"], dtype=float)

        baseline = run_official_baseline(algorithm_id, X, params)
        W_est = np.asarray(baseline.W_est, dtype=float)
        if W_est.shape != (X.shape[1], X.shape[1]):
            raise WorkflowValidationError(
                f"{algorithm_id} returned shape {W_est.shape}; expected {(X.shape[1], X.shape[1])}."
            )
        np.fill_diagonal(W_est, 0.0)
        B_est = np.asarray(baseline.B_est, dtype=int)
        edge_scores = np.asarray(baseline.edge_scores, dtype=float)
        labels = data_parent.public["data"]["feature_order"]
        ref = self.storage.write_npz(
            self.run_dir,
            f"{node.id}_{algorithm_id}_result",
            node_id=node.id,
            node_type=node.type,
            output_kind="algorithm_result",
            W_est=W_est,
            B_est=B_est,
            edge_scores=edge_scores,
        )
        metadata = get_algorithm_metadata(algorithm_id)
        graph_space = baseline.graph_space
        is_graph_dag = bool(baseline.is_dag)
        result = {
            "algorithm": algorithm_id,
            "provider": metadata.get("provider", baseline.provider),
            "official_origin": metadata.get("origin"),
            "package": metadata.get("package"),
            "params": baseline.params or {},
            "runtime": baseline.runtime,
            "n_iter": baseline.n_iter,
            "converged": baseline.converged,
            "is_dag": is_graph_dag,
            "graph_space": graph_space,
            "w_threshold": threshold,
            "result_graph": {
                "node_labels": labels,
                "nodes": graph_nodes(labels),
                "edge_list": edge_list_from_matrix(W_est, labels, threshold=threshold),
                "graph_meta": {
                    "graph_space": graph_space,
                    "d": int(W_est.shape[0]),
                    "s0": int(np.count_nonzero(B_est)),
                    "is_dag": is_graph_dag,
                    "algorithm": algorithm_id,
                },
            },
            "matrix_summary": {
                "W_est": matrix_summary(W_est),
                "B_est": matrix_summary(B_est),
                "edge_scores": matrix_summary(edge_scores),
            },
            "matrix_ref": ref,
        }
        result["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_{algorithm_id}_result",
            result,
            node_id=node.id,
            node_type=node.type,
            output_kind="algorithm_result",
            summary={
                "algorithm": algorithm_id,
                "runtime": baseline.runtime,
                "is_dag": is_graph_dag,
                "graph_space": graph_space,
            },
        )
        return NodeContext(
            public={"kind": "algorithm_result", "algorithm_result": result},
            arrays={"W_est": W_est, "B_est": B_est, "edge_scores": edge_scores},
        )

    def _execute_evaluation(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
    ) -> NodeContext:
        params = _node_params(node)
        mode = str(params.get("mode", "compare"))
        if mode == "bic":
            return self._execute_bic_evaluation(node, parents, input_edges, params)
        return self._execute_compare_evaluation(node, parents, input_edges, params)

    def _execute_compare_evaluation(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
        params: dict[str, Any],
    ) -> NodeContext:
        metrics = list(
            params.get("metrics")
            or ["shd", "f1", "tpr", "fdr", "fpr", "precision", "recall", "nnz", "aupr", "dag_error", "is_acyclic", "sid"]
        )
        warnings: list[str] = []
        graph_likes = self._graph_likes_from_inputs(parents, input_edges)
        truth, prediction = self._select_compare_graphs(graph_likes)
        threshold = _float_param(params, "threshold", 0.3)
        if prediction.kind == "algorithm_result":
            algorithm_parent = next((parent for parent in parents if parent.public.get("kind") == "algorithm_result"), None)
            if algorithm_parent is not None:
                threshold = _float_param(
                    params,
                    "threshold",
                    float(algorithm_parent.public["algorithm_result"].get("w_threshold", threshold) or threshold),
                )
        graph_space = str(params.get("graph_space", prediction.graph_space or truth.graph_space or "dag"))
        B_true = np.asarray(truth.B, dtype=int)
        W_est = np.asarray(prediction.W, dtype=float)
        edge_scores = np.asarray(prediction.scores, dtype=float)

        calc_metrics = [metric for metric in metrics if metric != "sid"]
        try:
            calculator = MetricsCalculator(metrics=calc_metrics, threshold=threshold, graph_space=graph_space)
            metric_values = calculator.calculate(B_true, W_est, score_est=edge_scores, return_all=True)
        except ImportError as exc:
            warnings.append(f"{graph_space} metrics unavailable: {exc}. Falling back to dag metrics.")
            fallback_metrics = [metric for metric in calc_metrics if metric != "aupr"]
            calculator = MetricsCalculator(metrics=fallback_metrics, threshold=threshold, graph_space="dag")
            metric_values = calculator.calculate(B_true, W_est, return_all=False)
            graph_space = "dag"
        except ValueError as exc:
            raise WorkflowValidationError(str(exc)) from exc

        if "sid" in metrics:
            try:
                metric_values["sid"] = sid_score(B_true, binary_adjacency(W_est, threshold))
            except ImportError as exc:
                warnings.append(f"SID unavailable: {exc}.")
            except Exception as exc:
                warnings.append(f"SID skipped: {exc}.")

        payload = {
            "metrics": metric_values,
            "eval_meta": {
                "mode": "compare",
                "threshold": threshold,
                "graph_space": graph_space,
                "truth_source": truth.source,
                "prediction_source": prediction.source,
                "n_features": int(B_true.shape[0]),
            },
        }
        payload["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_evaluation",
            payload,
            node_id=node.id,
            node_type=node.type,
            output_kind="evaluation",
            summary=payload["metrics"],
        )
        return NodeContext(public={"kind": "evaluation", "evaluation": payload}, warnings=warnings)

    def _execute_bic_evaluation(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
        params: dict[str, Any],
    ) -> NodeContext:
        data_parent = self._find_optional_parent(parents, "data")
        if data_parent is None:
            raise WorkflowValidationError("Evaluation BIC mode requires graph + data inputs; missing: data.")
        graph_likes = self._graph_likes_from_inputs(parents, input_edges)
        graph = self._select_bic_graph(graph_likes)
        X = np.asarray(data_parent.arrays["X"], dtype=float)
        if X.ndim != 2:
            raise WorkflowValidationError("BIC requires a two-dimensional data matrix.")
        if graph.B.shape[0] != X.shape[1]:
            raise WorkflowValidationError(
                f"BIC graph/data shape mismatch: graph has {graph.B.shape[0]} nodes but data has {X.shape[1]} features."
            )
        scores = _linear_gaussian_bic(X, graph.B)
        metrics = {
            **scores,
            "nnz": float(np.count_nonzero(graph.B)),
            "dag_error": float(0.0 if is_dag(graph.W) else 1.0),
            "is_acyclic": 1.0 if is_dag(graph.W) else 0.0,
        }
        payload = {
            "metrics": metrics,
            "eval_meta": {
                "mode": "bic",
                "graph_source": graph.source,
                "data_source": data_parent.public["data"]["data_meta"].get("source", "synthetic"),
                "n_samples": int(X.shape[0]),
                "n_features": int(X.shape[1]),
                "score_direction": "lower_is_better",
            },
        }
        payload["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_evaluation",
            payload,
            node_id=node.id,
            node_type=node.type,
            output_kind="evaluation",
            summary=payload["metrics"],
        )
        return NodeContext(public={"kind": "evaluation", "evaluation": payload})

    def _execute_evaluation_summary(
        self,
        node: WorkflowNode,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
    ) -> NodeContext:
        params = _node_params(node)
        selected_metrics = [str(item) for item in params.get("metrics", []) if str(item)]
        selected_metric_set = set(selected_metrics)
        primary_metric = str(params.get("primary_metric", "f1"))
        sort_order = str(params.get("sort_order", "auto"))
        if sort_order not in {"auto", "asc", "desc"}:
            raise WorkflowValidationError("Evaluation summary sort_order must be `auto`, `asc`, or `desc`.")
        effective_sort_order = _resolve_sort_order(primary_metric, sort_order)

        rows: list[dict[str, Any]] = []
        metric_names: set[str] = set()
        for index, parent in enumerate(parents):
            if parent.public.get("kind") != "evaluation":
                continue
            evaluation = parent.public.get("evaluation")
            if not isinstance(evaluation, dict):
                continue
            metrics = evaluation.get("metrics")
            if not isinstance(metrics, dict):
                continue
            edge = input_edges[index] if index < len(input_edges) else None
            source_node_id = edge.source if edge is not None else f"evaluation_{index + 1}"
            row: dict[str, Any] = {
                "rank": 0,
                "source_node_id": source_node_id,
                "label": _evaluation_label(source_node_id, evaluation),
                "mode": evaluation.get("eval_meta", {}).get("mode") if isinstance(evaluation.get("eval_meta"), dict) else None,
            }
            for key, value in metrics.items():
                if selected_metric_set and key not in selected_metric_set and key != primary_metric:
                    continue
                parsed = _finite_float(value)
                if parsed is None:
                    continue
                row[key] = parsed
                metric_names.add(key)
            rows.append(row)

        if not rows:
            raise WorkflowValidationError("Evaluation summary requires at least one evaluation input.")

        def primary_value(row: dict[str, Any]) -> tuple[int, float]:
            value = _finite_float(row.get(primary_metric))
            if value is None:
                return (1, 0.0)
            return (0, -value if effective_sort_order == "desc" else value)

        rows.sort(key=primary_value)
        for rank, row in enumerate(rows, start=1):
            row["rank"] = rank

        best_by_metric: dict[str, dict[str, Any]] = {}
        for metric in sorted(metric_names):
            values = [(row, _finite_float(row.get(metric))) for row in rows]
            values = [(row, value) for row, value in values if value is not None]
            if not values:
                continue
            direction = _metric_sort_direction(metric)
            best_row, best_value = sorted(values, key=lambda item: item[1], reverse=direction == "desc")[0]
            best_by_metric[metric] = {
                "label": best_row["label"],
                "source_node_id": best_row["source_node_id"],
                "value": best_value,
                "direction": "lower_is_better" if direction == "asc" else "higher_is_better",
            }

        summary = {
            "rows": rows,
            "metrics": sorted(metric_names),
            "primary_metric": primary_metric,
            "sort_order": sort_order,
            "effective_sort_order": effective_sort_order,
            "best_by_metric": best_by_metric,
            "summary_meta": {
                "evaluation_count": len(rows),
                "ranked_by": primary_metric,
                "effective_sort_order": effective_sort_order,
            },
        }
        summary["artifact_ref"] = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_evaluation_summary",
            summary,
            node_id=node.id,
            node_type=node.type,
            output_kind="evaluation_summary",
            summary={
                "evaluation_count": len(rows),
                "primary_metric": primary_metric,
                "best": best_by_metric.get(primary_metric),
            },
        )
        return NodeContext(public={"kind": "evaluation_summary", "evaluation_summary": summary})

    def _graph_likes_from_inputs(
        self,
        parents: list[NodeContext],
        input_edges: list[WorkflowEdge],
    ) -> list[GraphLike]:
        result: list[GraphLike] = []
        for index, parent in enumerate(parents):
            graph_like = self._graph_like_from_context(parent)
            if graph_like is None:
                continue
            port_id = input_edges[index].target_handle if index < len(input_edges) else None
            result.append(
                GraphLike(
                    source=graph_like.source,
                    kind=graph_like.kind,
                    labels=graph_like.labels,
                    W=graph_like.W,
                    B=graph_like.B,
                    scores=graph_like.scores,
                    graph_space=graph_like.graph_space,
                    port_id=port_id,
                )
            )
        return result

    def _graph_like_from_context(self, parent: NodeContext) -> Optional[GraphLike]:
        kind = str(parent.public.get("kind", ""))
        if kind == "graph":
            W = np.asarray(parent.arrays.get("W_true", parent.arrays.get("B_true")), dtype=float)
            B = binary_adjacency(W)
            graph = parent.public["graph"]
            return GraphLike(
                source="graph",
                kind=kind,
                labels=list(graph.get("node_labels") or [f"X{i + 1}" for i in range(W.shape[0])]),
                W=W,
                B=B,
                scores=np.abs(W),
                graph_space=str(graph.get("graph_meta", {}).get("graph_space", "dag")),
            )
        if kind == "data":
            W = np.asarray(parent.arrays.get("W_true", parent.arrays.get("B_true")), dtype=float)
            B = np.asarray(parent.arrays.get("B_true", binary_adjacency(W)), dtype=int)
            data = parent.public["data"]
            return GraphLike(
                source="data.B_true",
                kind=kind,
                labels=list(data.get("feature_order") or [f"X{i + 1}" for i in range(W.shape[0])]),
                W=W,
                B=B,
                scores=np.abs(W),
                graph_space="dag",
            )
        if kind == "algorithm_result":
            W = np.asarray(parent.arrays.get("W_est", parent.arrays.get("B_est")), dtype=float)
            threshold = float(parent.public["algorithm_result"].get("w_threshold", 0.0) or 0.0)
            B = np.asarray(parent.arrays.get("B_est", binary_adjacency(W, threshold)), dtype=int)
            result = parent.public["algorithm_result"]
            graph = result.get("result_graph", {})
            return GraphLike(
                source=f"algorithm_result:{result.get('algorithm', 'unknown')}",
                kind=kind,
                labels=list(graph.get("node_labels") or [f"X{i + 1}" for i in range(W.shape[0])]),
                W=W,
                B=B,
                scores=np.asarray(parent.arrays.get("edge_scores", np.abs(W)), dtype=float),
                graph_space=str(result.get("graph_space", "dag")),
            )
        return None

    def _select_compare_graphs(self, graph_likes: list[GraphLike]) -> tuple[GraphLike, GraphLike]:
        by_port = {graph.port_id: graph for graph in graph_likes if graph.port_id}
        if "truth_graph" in by_port and "pred_graph" in by_port:
            return by_port["truth_graph"], by_port["pred_graph"]

        truth = next((graph for graph in graph_likes if graph.kind == "data"), None)
        prediction = next((graph for graph in graph_likes if graph.kind == "algorithm_result"), None)
        if truth is not None and prediction is not None and truth is not prediction:
            return truth, prediction

        truth = truth or next((graph for graph in graph_likes if graph.kind == "graph"), None)
        prediction = prediction or next((graph for graph in graph_likes if graph is not truth), None)
        if truth is None or prediction is None:
            raise WorkflowValidationError("Evaluation compare mode requires two graph inputs.")
        return truth, prediction

    def _select_bic_graph(self, graph_likes: list[GraphLike]) -> GraphLike:
        graph = next((item for item in graph_likes if item.port_id in {"graph", "truth_graph", "pred_graph"}), None)
        graph = graph or next((item for item in graph_likes if item.kind == "algorithm_result"), None)
        graph = graph or next((item for item in graph_likes if item.kind == "graph"), None)
        graph = graph or next((item for item in graph_likes if item.kind == "data"), None)
        if graph is None:
            raise WorkflowValidationError("Evaluation BIC mode requires graph + data inputs; missing: graph.")
        return graph

    def _execute_graph_view(self, node: WorkflowNode, parents: list[NodeContext]) -> NodeContext:
        params = _node_params(node)
        threshold = _float_param(params, "threshold", 0.3)
        top_k = int(params.get("top_k") if _has_value(params.get("top_k")) else 200)
        compare_mode = str(params.get("compare_mode") if _has_value(params.get("compare_mode")) else "single")

        algorithm_parent = self._find_optional_parent(parents, "algorithm_result")
        data_parent = self._find_optional_parent(parents, "data")
        graph_parent = self._find_optional_parent(parents, "graph")
        evaluation_parent = self._find_optional_parent(parents, "evaluation")

        warnings: list[str] = []
        if compare_mode in {"true_vs_pred", "overlay"} and algorithm_parent is not None and data_parent is not None:
            labels = data_parent.public["data"]["feature_order"]
            edges = overlay_edges(
                data_parent.arrays["B_true"],
                algorithm_parent.arrays["W_est"],
                labels,
                threshold=threshold,
                top_k=top_k,
            )
            nodes = graph_nodes(labels)
            source = "overlay"
        elif algorithm_parent is not None:
            labels = algorithm_parent.public["algorithm_result"]["result_graph"]["node_labels"]
            edges = edge_list_from_matrix(
                algorithm_parent.arrays["W_est"],
                labels,
                threshold=threshold,
                top_k=top_k,
            )
            nodes = graph_nodes(labels)
            source = algorithm_parent.public["algorithm_result"]["algorithm"]
        elif graph_parent is not None:
            labels = graph_parent.public["graph"]["node_labels"]
            edges = edge_list_from_matrix(graph_parent.arrays["W_true"], labels, threshold=0.0, top_k=top_k)
            nodes = graph_nodes(labels)
            source = "truth"
        elif data_parent is not None:
            labels = data_parent.public["data"]["feature_order"]
            edges = edge_list_from_matrix(data_parent.arrays["W_true"], labels, threshold=0.0, top_k=top_k)
            nodes = graph_nodes(labels)
            source = "data.B_true"
        else:
            raise WorkflowValidationError("Graph view requires a graph or algorithm result input.")

        if len(edges) >= top_k:
            warnings.append(f"Graph view limited to top {top_k} edges.")
        view = {
            "nodes": nodes,
            "edges": edges,
            "render_meta": {
                "source": source,
                "compare_mode": compare_mode,
                "threshold": threshold,
                "top_k": top_k,
                "edge_count": len(edges),
            },
        }
        if evaluation_parent is not None:
            view["evaluation"] = evaluation_parent.public["evaluation"]
        ref = self.storage.write_artifact_json(
            self.run_dir,
            f"{node.id}_graph_view",
            view,
            node_id=node.id,
            node_type=node.type,
            output_kind="graph_view",
            summary=view["render_meta"],
        )
        view["artifact_ref"] = ref
        return NodeContext(public={"kind": "graph_view", "graph_view": view}, warnings=warnings)
