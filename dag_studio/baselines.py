"""Official-library baseline adapters for the public DAGBoard package."""

from __future__ import annotations

import inspect
import time
from dataclasses import dataclass
from importlib.util import find_spec
from typing import Any

import numpy as np

from dag_studio.graph_utils import binary_adjacency
from dag_studio.simulation import is_dag, set_random_seed


@dataclass
class BaselineResult:
    W_est: np.ndarray
    B_est: np.ndarray
    edge_scores: np.ndarray
    provider: str
    graph_space: str
    runtime: float
    n_iter: int = 0
    converged: bool = True
    is_dag: bool = False
    params: dict[str, Any] | None = None


BASELINE_CATALOG = [
    {
        "name": "PC",
        "provider": "gCastle",
        "origin": "castle.algorithms.PC",
        "category": "constraint",
        "tier": "official-baseline",
        "note": "Official gCastle PC wrapper.",
        "package": "castle",
        "graph_space": "cpdag",
    },
    {
        "name": "GES",
        "provider": "gCastle",
        "origin": "castle.algorithms.GES",
        "category": "score",
        "tier": "official-baseline",
        "note": "Official gCastle GES wrapper.",
        "package": "castle",
        "graph_space": "cpdag",
    },
    {
        "name": "Notears",
        "provider": "gCastle",
        "origin": "castle.algorithms.Notears",
        "category": "continuous",
        "tier": "official-baseline",
        "note": "Official gCastle NOTEARS linear wrapper.",
        "package": "castle",
        "graph_space": "dag",
    },
    {
        "name": "NotearsLowRank",
        "provider": "gCastle",
        "origin": "castle.algorithms.NotearsLowRank",
        "category": "continuous",
        "tier": "official-baseline",
        "note": "Official gCastle NOTEARS low-rank wrapper.",
        "package": "castle",
        "graph_space": "dag",
    },
    {
        "name": "NotearsNonlinear",
        "provider": "gCastle",
        "origin": "castle.algorithms.NotearsNonlinear",
        "category": "continuous",
        "tier": "official-baseline",
        "note": "Official gCastle NOTEARS nonlinear wrapper.",
        "package": "castle",
        "graph_space": "dag",
    },
    {
        "name": "DAGMA",
        "provider": "DAGMA",
        "origin": "dagma.linear.DagmaLinear",
        "category": "continuous",
        "tier": "official-baseline",
        "note": "Official DAGMA linear wrapper.",
        "package": "dagma",
        "graph_space": "dag",
    },
]


def list_algorithm_catalog() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in BASELINE_CATALOG:
        package = str(row["package"])
        registered = bool(find_spec(package))
        rows.append(
            {
                **row,
                "registered": registered,
                "supports_standard_tabular": True,
            }
        )
    return rows


def get_algorithm_metadata(name: str) -> dict[str, Any]:
    for row in list_algorithm_catalog():
        if row["name"] == name:
            return row
    raise ValueError(f"Unknown official baseline: {name}")


def run_official_baseline(name: str, X: np.ndarray, params: dict[str, Any]) -> BaselineResult:
    if name == "DAGMA":
        return _run_dagma(X, params)
    return _run_castle(name, X, params)


def _run_castle(name: str, X: np.ndarray, params: dict[str, Any]) -> BaselineResult:
    from castle import algorithms as castle_algorithms

    if not hasattr(castle_algorithms, name):
        raise ValueError(f"gCastle baseline is not available: {name}")
    algo_cls = getattr(castle_algorithms, name)
    threshold = _float_param(params, "w_threshold", 0.3)
    seed = params.get("seed")
    if _has_value(seed):
        set_random_seed(int(seed))
    init_params = _supported_kwargs(algo_cls.__init__, _library_params(params))
    start = time.time()
    learner = algo_cls(**init_params)
    learn_params: dict[str, Any] = {}
    if name == "NotearsLowRank":
        learn_params.setdefault("rank", int(params.get("rank") if _has_value(params.get("rank")) else 2))
    elif name == "PC":
        pc_learn_options = _library_params(params)
        learn_params = {
            key: value
            for key, value in pc_learn_options.items()
            if key in {"p_cores", "s", "batch"} and value is not None
        }
    if hasattr(learner, "learn"):
        learner.learn(X, **learn_params)
    elif hasattr(learner, "fit"):
        learner.fit(X, **learn_params)
    else:
        raise ValueError(f"gCastle baseline {name} does not expose learn/fit.")
    runtime = time.time() - start
    W_est = _extract_castle_matrix(learner)
    graph_space = str(get_algorithm_metadata(name).get("graph_space", "dag"))
    if graph_space == "cpdag":
        B_est = binary_adjacency(W_est, 0.0)
    else:
        B_est = binary_adjacency(W_est, threshold)
    return BaselineResult(
        W_est=W_est,
        B_est=B_est,
        edge_scores=np.abs(W_est),
        provider="gCastle",
        graph_space=graph_space,
        runtime=runtime,
        n_iter=int(getattr(learner, "n_iter_", 0) or 0),
        converged=bool(getattr(learner, "converged_", True)),
        is_dag=bool(is_dag(B_est)) if graph_space == "dag" else False,
        params={**init_params, **learn_params},
    )


def _run_dagma(X: np.ndarray, params: dict[str, Any]) -> BaselineResult:
    from dagma.linear import DagmaLinear

    threshold = _float_param(params, "w_threshold", 0.3)
    seed = params.get("seed")
    if _has_value(seed):
        set_random_seed(int(seed))
    learner = DagmaLinear(
        loss_type=str(params.get("loss_type") if _has_value(params.get("loss_type")) else "l2"),
        verbose=bool(params.get("verbose", False)),
    )
    fit_params = _supported_kwargs(learner.fit, _library_params(params))
    start = time.time()
    W_est = np.asarray(learner.fit(X, **fit_params), dtype=float)
    runtime = time.time() - start
    np.fill_diagonal(W_est, 0.0)
    B_est = binary_adjacency(W_est, threshold)
    return BaselineResult(
        W_est=W_est,
        B_est=B_est,
        edge_scores=np.abs(W_est),
        provider="DAGMA",
        graph_space="dag",
        runtime=runtime,
        n_iter=int(fit_params.get("max_iter", 0) or 0),
        converged=True,
        is_dag=bool(is_dag(B_est)),
        params=fit_params,
    )


def _library_params(params: dict[str, Any]) -> dict[str, Any]:
    raw_library_params = params.get("library_params")
    values = dict(raw_library_params) if isinstance(raw_library_params, dict) else {}
    for key, value in params.items():
        if key not in {"algorithm_id", "library_params", "module", "seed"} and _has_value(value):
            values.setdefault(key, value)
    return values


def _supported_kwargs(callable_obj: Any, params: dict[str, Any]) -> dict[str, Any]:
    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return {key: value for key, value in params.items() if _has_value(value)}
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values()):
        return {key: value for key, value in params.items() if _has_value(value)}
    accepted = set(signature.parameters)
    accepted.discard("self")
    return {key: value for key, value in params.items() if key in accepted and _has_value(value)}


def _has_value(value: Any) -> bool:
    return value is not None and value != ""


def _float_param(params: dict[str, Any], key: str, default: float) -> float:
    value = params.get(key)
    return float(value) if _has_value(value) else default


def _extract_castle_matrix(learner: Any) -> np.ndarray:
    for attr in ["weight_causal_matrix", "causal_matrix"]:
        if hasattr(learner, attr):
            return _to_numpy(getattr(learner, attr))
    raise ValueError("Official baseline did not expose causal_matrix.")


def _to_numpy(value: Any) -> np.ndarray:
    if hasattr(value, "numpy"):
        value = value.numpy()
    arr = np.asarray(value, dtype=float)
    if arr.ndim != 2 or arr.shape[0] != arr.shape[1]:
        raise ValueError(f"Expected square adjacency matrix, got shape {arr.shape}.")
    np.fill_diagonal(arr, 0.0)
    return arr
