from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from dag_studio.baselines import BaselineResult
from dag_studio.execution import WorkflowExecutor, WorkflowValidationError, topological_order
from dag_studio.jobs import JobManager
from dag_studio.schemas import WorkflowDefinition
from dag_studio.storage import LocalStudioStorage


def _workflow(algorithm_id: str = "PC") -> WorkflowDefinition:
    algo_params = {
        "algorithm_id": algorithm_id,
        "max_iter": 20,
        "w_threshold": 0.2,
        "seed": 7,
    }
    if algorithm_id == "DAGMA":
        algo_params.update({"warm_iter": 20, "T": 1, "lambda1": 0.03})
    if algorithm_id == "NotearsLowRank":
        algo_params.update({"rank": 2, "max_iter": 2})
    return WorkflowDefinition(
        name=f"{algorithm_id} smoke",
        nodes=[
            {
                "id": "structure",
                "type": "structure_generator",
                "position": {"x": 0, "y": 0},
                "data": {"params": {"d": 5, "s0": 4, "graph_type": "ER", "seed": 7}},
            },
            {
                "id": "data",
                "type": "data_generator",
                "position": {"x": 1, "y": 0},
                "data": {"params": {"n_samples": 35, "sem_type": "gauss", "seed": 7}},
            },
            {
                "id": "algo",
                "type": "algorithm",
                "position": {"x": 2, "y": 0},
                "data": {"params": algo_params},
            },
            {
                "id": "eval",
                "type": "evaluation",
                "position": {"x": 3, "y": 0},
                "data": {
                    "params": {
                        "metrics": ["shd", "f1", "tpr", "fdr", "precision", "recall", "nnz"],
                        "threshold": 0.2,
                    }
                },
            },
            {
                "id": "view",
                "type": "graph_view",
                "position": {"x": 4, "y": 0},
                "data": {"params": {"compare_mode": "overlay", "threshold": 0.2, "top_k": 50}},
            },
        ],
        edges=[
            {"source": "structure", "target": "data"},
            {"source": "data", "target": "algo"},
            {"source": "data", "target": "eval"},
            {"source": "algo", "target": "eval"},
            {"source": "data", "target": "view"},
            {"source": "algo", "target": "view"},
            {"source": "eval", "target": "view"},
        ],
    )


def _studio_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    import dag_studio.main as main

    test_storage = LocalStudioStorage(tmp_path)
    monkeypatch.setattr(main, "storage", test_storage)
    monkeypatch.setattr(main, "jobs", JobManager(storage=test_storage, max_workers=1))
    return TestClient(main.app)


def _start_run(
    client: TestClient,
    workflow: WorkflowDefinition,
    run_payload: dict[str, Any] | None = None,
) -> str:
    saved = client.post("/api/workflows", json=workflow.model_dump(mode="json"))
    assert saved.status_code == 200
    workflow_id = saved.json()["id"]
    started = client.post(f"/api/workflows/{workflow_id}/run", json=run_payload or {})
    assert started.status_code == 200
    return started.json()["run_id"]


def _wait_for_run(client: TestClient, run_id: str, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    manifest = client.get(f"/api/runs/{run_id}").json()
    while manifest["status"] not in {"completed", "failed"} and time.time() < deadline:
        time.sleep(0.1)
        manifest = client.get(f"/api/runs/{run_id}").json()
    assert manifest["status"] in {"completed", "failed"}
    return manifest


def _artifact_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("artifacts", "items"):
            items = payload.get(key)
            if isinstance(items, list):
                return items
    pytest.fail(f"artifact list response must be a list or contain an artifacts/items list: {payload!r}")


def test_topological_order_rejects_cycles() -> None:
    workflow = WorkflowDefinition(
        name="cycle",
        nodes=[
            {"id": "a", "type": "structure_generator"},
            {"id": "b", "type": "data_generator"},
        ],
        edges=[
            {"source": "a", "target": "b"},
            {"source": "b", "target": "a"},
        ],
    )
    with pytest.raises(WorkflowValidationError):
        topological_order(workflow)


def test_workflow_executor_smoke(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("smoke")
    records = WorkflowExecutor(storage, run_dir).execute(_workflow())

    assert {record.status for record in records.values()} == {"success"}
    assert records["structure"].outputs["kind"] == "graph"
    assert records["data"].outputs["kind"] == "data"
    assert records["data"].outputs["data"]["data_preview"]["columns"]
    assert records["data"].outputs["data"]["data_preview"]["rows"]
    assert "metrics" in records["eval"].outputs["evaluation"]
    assert records["view"].outputs["graph_view"]["edges"]


def test_algorithm_node_treats_blank_optional_params_as_defaults(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_baseline(name: str, X: np.ndarray, params: dict[str, Any]) -> BaselineResult:
        assert name == "PC"
        assert params["w_threshold"] is None
        W = np.zeros((X.shape[1], X.shape[1]), dtype=float)
        return BaselineResult(
            W_est=W,
            B_est=np.zeros_like(W, dtype=int),
            edge_scores=W,
            provider="test",
            graph_space="dag",
            runtime=0.0,
            is_dag=True,
            params={},
        )

    import dag_studio.execution as execution

    monkeypatch.setattr(execution, "run_official_baseline", fake_baseline)
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("blank-algorithm-params")
    workflow = _workflow("PC")
    for node in workflow.nodes:
        if node.id == "algo":
            node.data["params"] = {
                "algorithm_id": "PC",
                "alpha": None,
                "variant": None,
                "criterion": None,
                "lambda1": None,
                "lambda2": None,
                "max_iter": None,
                "warm_iter": None,
                "T": None,
                "rank": None,
                "w_threshold": None,
                "seed": None,
                "library_params": None,
            }

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert records["algo"].status == "success"
    assert records["algo"].outputs["algorithm_result"]["w_threshold"] == 0.3


def test_data_generator_accepts_algorithm_graph_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_baseline(name: str, X: np.ndarray, params: dict[str, Any]) -> BaselineResult:
        W = np.zeros((X.shape[1], X.shape[1]), dtype=float)
        W[0, 1] = 0.7
        return BaselineResult(
            W_est=W,
            B_est=(W != 0).astype(int),
            edge_scores=np.abs(W),
            provider="test",
            graph_space="dag",
            runtime=0.0,
            is_dag=True,
            params={},
        )

    import dag_studio.execution as execution

    monkeypatch.setattr(execution, "run_official_baseline", fake_baseline)
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("algorithm-graph-to-data")
    workflow = WorkflowDefinition(
        name="algorithm graph to data",
        nodes=[
            {"id": "structure", "type": "structure_generator", "data": {"params": {"d": 4, "s0": 3, "seed": 21}}},
            {"id": "data", "type": "data_generator", "data": {"params": {"n_samples": 20, "seed": 21}}},
            {"id": "algo", "type": "algorithm", "data": {"params": {"algorithm_id": "PC", "w_threshold": None}}},
            {"id": "resample", "type": "data_generator", "data": {"params": {"n_samples": 15, "seed": 22}}},
        ],
        edges=[
            {"source": "structure", "target": "data", "sourceHandle": "graph", "targetHandle": "graph"},
            {"source": "data", "target": "algo", "sourceHandle": "data", "targetHandle": "data"},
            {"source": "algo", "target": "resample", "sourceHandle": "graph", "targetHandle": "graph"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert {record.status for record in records.values()} == {"success"}
    assert records["resample"].outputs["data"]["data_meta"]["graph_source"] == "algorithm_result:PC"


def test_multi_algorithm_workflow_evaluates_each_branch(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("multi-algorithm")
    workflow = WorkflowDefinition(
        name="multi algorithm compare",
        nodes=[
            {
                "id": "structure",
                "type": "structure_generator",
                "position": {"x": 0, "y": 0},
                "data": {"params": {"d": 5, "s0": 4, "graph_type": "ER", "seed": 17}},
            },
            {
                "id": "data",
                "type": "data_generator",
                "position": {"x": 1, "y": 0},
                "data": {"params": {"n_samples": 35, "sem_type": "gauss", "seed": 17}},
            },
            {
                "id": "algo_pc",
                "type": "algorithm",
                "position": {"x": 2, "y": -1},
                "data": {"params": {"algorithm_id": "PC", "alpha": 0.05, "w_threshold": 0.2, "seed": 17}},
            },
            {
                "id": "algo_ges",
                "type": "algorithm",
                "position": {"x": 2, "y": 1},
                "data": {"params": {"algorithm_id": "GES", "criterion": "bic", "w_threshold": 0.2, "seed": 17}},
            },
            {
                "id": "eval_pc",
                "type": "evaluation",
                "position": {"x": 3, "y": -1},
                "data": {"params": {"mode": "compare", "threshold": 0.2}},
            },
            {
                "id": "eval_ges",
                "type": "evaluation",
                "position": {"x": 3, "y": 1},
                "data": {"params": {"mode": "compare", "threshold": 0.2}},
            },
            {
                "id": "summary",
                "type": "evaluation_summary",
                "position": {"x": 4, "y": 0},
                "data": {"params": {"primary_metric": "shd", "sort_order": "auto"}},
            },
        ],
        edges=[
            {"id": "structure-data", "source": "structure", "target": "data", "sourceHandle": "graph", "targetHandle": "graph"},
            {"id": "data-pc", "source": "data", "target": "algo_pc", "sourceHandle": "data", "targetHandle": "data"},
            {"id": "data-ges", "source": "data", "target": "algo_ges", "sourceHandle": "data", "targetHandle": "data"},
            {"id": "graph-pc-a", "source": "data", "target": "eval_pc", "sourceHandle": "graph", "targetHandle": "graph"},
            {"id": "graph-ges-a", "source": "data", "target": "eval_ges", "sourceHandle": "graph", "targetHandle": "graph"},
            {"id": "graph-pc-b", "source": "algo_pc", "target": "eval_pc", "sourceHandle": "graph", "targetHandle": "graph"},
            {"id": "graph-ges-b", "source": "algo_ges", "target": "eval_ges", "sourceHandle": "graph", "targetHandle": "graph"},
            {"id": "pc-summary", "source": "eval_pc", "target": "summary", "sourceHandle": "evaluation", "targetHandle": "evaluation"},
            {"id": "ges-summary", "source": "eval_ges", "target": "summary", "sourceHandle": "evaluation", "targetHandle": "evaluation"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert {record.status for record in records.values()} == {"success"}
    assert records["algo_pc"].outputs["algorithm_result"]["algorithm"] == "PC"
    assert records["algo_ges"].outputs["algorithm_result"]["algorithm"] == "GES"
    assert "shd" in records["eval_pc"].outputs["evaluation"]["metrics"]
    assert "shd" in records["eval_ges"].outputs["evaluation"]["metrics"]
    summary = records["summary"].outputs["evaluation_summary"]
    assert summary["summary_meta"]["evaluation_count"] == 2
    assert summary["effective_sort_order"] == "asc"
    assert [row["shd"] for row in summary["rows"]] == sorted(row["shd"] for row in summary["rows"])
    assert [row["rank"] for row in summary["rows"]] == [1, 2]
    assert "f1" in summary["best_by_metric"]


def test_evaluation_compare_accepts_two_graph_like_inputs(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("compare")
    workflow = WorkflowDefinition(
        name="compare",
        nodes=[
            {
                "id": "structure",
                "type": "structure_generator",
                "position": {"x": 0, "y": 0},
                "data": {"params": {"d": 5, "s0": 4, "graph_type": "ER", "seed": 11}},
            },
            {
                "id": "data",
                "type": "data_generator",
                "position": {"x": 1, "y": 0},
                "data": {"params": {"n_samples": 30, "sem_type": "gauss", "seed": 11}},
            },
            {
                "id": "eval",
                "type": "evaluation",
                "position": {"x": 2, "y": 0},
                "data": {
                    "params": {
                        "mode": "compare",
                        "metrics": ["shd", "f1", "tpr", "fdr", "fpr", "precision", "recall", "nnz", "dag_error", "is_acyclic", "sid"],
                        "threshold": 0.0,
                    }
                },
            },
        ],
        edges=[
            {"source": "structure", "target": "data", "sourceHandle": "graph", "targetHandle": "graph"},
            {"source": "structure", "target": "eval", "sourceHandle": "graph", "targetHandle": "graph"},
            {"source": "data", "target": "eval", "sourceHandle": "graph", "targetHandle": "graph"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert records["eval"].status == "success"
    evaluation = records["eval"].outputs["evaluation"]
    assert evaluation["eval_meta"]["mode"] == "compare"
    assert {"shd", "f1", "tpr", "fdr", "fpr", "precision", "recall", "nnz", "dag_error", "is_acyclic"} <= set(evaluation["metrics"])


def test_evaluation_compare_blocks_when_second_structure_missing(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("compare-missing")
    workflow = WorkflowDefinition(
        name="compare missing",
        nodes=[
            {"id": "structure", "type": "structure_generator", "data": {"params": {"d": 5, "s0": 4, "seed": 12}}},
            {"id": "eval", "type": "evaluation", "data": {"params": {"mode": "compare"}}},
        ],
        edges=[
            {"source": "structure", "target": "eval", "sourceHandle": "graph", "targetHandle": "graph"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert records["eval"].status == "blocked"
    assert "graph x1" in (records["eval"].error or "")


def test_evaluation_bic_requires_graph_and_data(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("bic")
    workflow = WorkflowDefinition(
        name="bic",
        nodes=[
            {"id": "structure", "type": "structure_generator", "data": {"params": {"d": 5, "s0": 4, "seed": 13}}},
            {"id": "data", "type": "data_generator", "data": {"params": {"n_samples": 30, "sem_type": "gauss", "seed": 13}}},
            {"id": "eval", "type": "evaluation", "data": {"params": {"mode": "bic"}}},
        ],
        edges=[
            {"source": "structure", "target": "data", "sourceHandle": "graph", "targetHandle": "graph"},
            {"source": "structure", "target": "eval", "sourceHandle": "graph", "targetHandle": "graph"},
            {"source": "data", "target": "eval", "sourceHandle": "data", "targetHandle": "data"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert records["eval"].status == "success"
    metrics = records["eval"].outputs["evaluation"]["metrics"]
    assert {"bic", "log_likelihood", "num_params", "n_samples", "n_features", "nnz", "dag_error", "is_acyclic"} <= set(metrics)
    assert records["eval"].outputs["evaluation"]["eval_meta"]["mode"] == "bic"


def test_evaluation_bic_blocks_without_data(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("bic-missing")
    workflow = WorkflowDefinition(
        name="bic missing",
        nodes=[
            {"id": "structure", "type": "structure_generator", "data": {"params": {"d": 5, "s0": 4, "seed": 14}}},
            {"id": "eval", "type": "evaluation", "data": {"params": {"mode": "bic"}}},
        ],
        edges=[
            {"source": "structure", "target": "eval", "sourceHandle": "graph", "targetHandle": "graph"},
        ],
    )

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    assert records["eval"].status == "blocked"
    assert "data" in (records["eval"].error or "")


@pytest.mark.parametrize("algorithm_id", ["PC", "GES", "Notears", "NotearsLowRank", "DAGMA"])
def test_algorithm_node_uses_library_wrappers(tmp_path: Path, algorithm_id: str) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir(algorithm_id)
    workflow = _workflow(algorithm_id)
    workflow.nodes = [node for node in workflow.nodes if node.id in {"structure", "data", "algo"}]
    workflow.edges = [edge for edge in workflow.edges if edge.target in {"data", "algo"}]

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    result = records["algo"].outputs["algorithm_result"]
    assert records["algo"].status == "success"
    assert result["algorithm"] == algorithm_id
    assert result["official_origin"]
    assert result["package"] in {"castle", "dagma"}
    assert result["matrix_summary"]["W_est"]["shape"] == [5, 5]


def test_algorithm_blank_params_do_not_override_official_defaults(tmp_path: Path) -> None:
    storage = LocalStudioStorage(tmp_path)
    _run_id, run_dir = storage.create_run_dir("notears-defaults")
    workflow = _workflow("Notears")
    for node in workflow.nodes:
        if node.id == "algo":
            node.data["params"] = {"algorithm_id": "Notears"}
    workflow.nodes = [node for node in workflow.nodes if node.id in {"structure", "data", "algo"}]
    workflow.edges = [edge for edge in workflow.edges if edge.target in {"data", "algo"}]

    records = WorkflowExecutor(storage, run_dir).execute(workflow)

    result = records["algo"].outputs["algorithm_result"]
    assert records["algo"].status == "success"
    assert result["params"] == {}


def test_api_workflow_run_and_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import dag_studio.main as main

    test_storage = LocalStudioStorage(tmp_path)
    monkeypatch.setattr(main, "storage", test_storage)
    monkeypatch.setattr(main, "jobs", JobManager(storage=test_storage, max_workers=1))

    client = TestClient(main.app)
    algorithms = client.get("/api/algorithms")
    assert algorithms.status_code == 200
    assert any(row["name"] == "PC" for row in algorithms.json())

    saved = client.post("/api/workflows", json=_workflow().model_dump(mode="json"))
    assert saved.status_code == 200
    workflow_id = saved.json()["id"]
    started = client.post(f"/api/workflows/{workflow_id}/run")
    assert started.status_code == 200
    run_id = started.json()["run_id"]

    seen = []
    with client.websocket_connect(f"/api/runs/{run_id}/events") as websocket:
        while True:
            try:
                event = websocket.receive_json()
            except WebSocketDisconnect:
                break
            event_name = event.get("type") or event.get("event")
            seen.append(event_name)
            if event_name in {"run.completed", "run.failed", "completed", "failed"}:
                break

    deadline = time.time() + 10
    manifest = client.get(f"/api/runs/{run_id}").json()
    while manifest["status"] not in {"completed", "failed"} and time.time() < deadline:
        time.sleep(0.1)
        manifest = client.get(f"/api/runs/{run_id}").json()

    assert manifest["status"] == "completed"
    assert {"run.queued", "queued"} & set(seen)
    assert {"node.completed", "node_completed"} & set(seen)
    assert {"run.completed", "completed"} & set(seen)


def test_partial_run_executes_target_upstream_closure_and_skips_downstream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _studio_client(tmp_path, monkeypatch)
    run_id = _start_run(client, _workflow(), {"target_node_id": "eval", "target_node_ids": ["eval"]})

    manifest = _wait_for_run(client, run_id)

    assert manifest["status"] == "completed"
    states = manifest["node_states"]
    assert {node_id: states[node_id]["status"] for node_id in ["structure", "data", "algo", "eval"]} == {
        "structure": "success",
        "data": "success",
        "algo": "success",
        "eval": "success",
    }
    assert states["view"]["status"] == "skipped"
    started_nodes = {
        event.get("node_id") or event.get("payload", {}).get("node_id")
        for event in manifest["events"]
        if (event.get("type") or event.get("event")) in {"node.started", "node_started"}
    }
    assert started_nodes == {"structure", "data", "algo", "eval"}


def test_disabled_node_is_skipped_and_dependents_are_blocked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workflow = _workflow()
    for node in workflow.nodes:
        if node.id == "algo":
            node.data["disabled"] = True

    client = _studio_client(tmp_path, monkeypatch)
    run_id = _start_run(client, workflow)
    manifest = _wait_for_run(client, run_id)

    assert manifest["status"] == "completed"
    states = manifest["node_states"]
    assert states["structure"]["status"] == "success"
    assert states["data"]["status"] == "success"
    assert states["algo"]["status"] == "skipped"
    assert states["eval"]["status"] == "blocked"
    assert states["view"]["status"] == "blocked"

    event_types = [event.get("type") or event.get("event") for event in manifest["events"]]
    assert "node.skipped" in event_types
    assert "node.blocked" in event_types


def test_run_events_are_structured_and_severity_tagged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _studio_client(tmp_path, monkeypatch)
    run_id = _start_run(client, _workflow())
    manifest = _wait_for_run(client, run_id)

    assert manifest["status"] == "completed"
    for event in manifest["events"]:
        assert {"index", "run_id", "timestamp", "type", "level", "category", "message"} <= set(event)
        assert event["run_id"] == run_id
        assert event["level"] in {"debug", "info", "warn", "error", "fatal"}
        assert event["category"] in {"lifecycle", "artifact", "metric", "validation", "system", "node"}
        assert isinstance(event["message"], str) and event["message"]

    queued = manifest["events"][0]
    assert queued["type"] in {"run.queued", "queued"}
    assert queued["level"] == "info"
    completed = manifest["events"][-1]
    assert completed["type"] in {"run.completed", "completed"}
    assert completed["level"] == "info"


def test_artifact_index_list_and_npz_preview_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _studio_client(tmp_path, monkeypatch)
    run_id = _start_run(client, _workflow())
    manifest = _wait_for_run(client, run_id)
    assert manifest["status"] == "completed"

    listed = client.get(f"/api/runs/{run_id}/artifacts")
    assert listed.status_code == 200
    artifacts = _artifact_items(listed.json())
    assert artifacts

    required_fields = {"artifact_id", "run_id", "node_id", "node_type", "kind", "name", "summary"}
    for artifact in artifacts:
        assert required_fields <= set(artifact)
        assert artifact["run_id"] == run_id
        assert artifact["kind"] in {"json", "npz"}

    node_ids = {artifact["node_id"] for artifact in artifacts}
    assert {"structure", "data", "algo", "eval", "view"} <= node_ids

    npz_artifact = next(artifact for artifact in artifacts if artifact["kind"] == "npz")
    array_summaries = npz_artifact.get("arrays") or npz_artifact.get("summary")
    assert isinstance(array_summaries, dict) and array_summaries
    array_name = next(iter(array_summaries))

    preview = client.get(
        f"/api/runs/{run_id}/artifacts/{npz_artifact['artifact_id']}/preview",
        params={"array": array_name, "limit": 2},
    )
    assert preview.status_code == 200
    payload = preview.json()
    artifact_meta = payload.get("artifact", payload)
    assert artifact_meta["artifact_id"] == npz_artifact["artifact_id"]
    assert artifact_meta["kind"] == "npz"
    assert payload["array"] == array_name
    assert payload["shape"] == array_summaries[array_name]["shape"]
    values = payload.get("values", payload.get("data"))
    assert len(values) <= 2
