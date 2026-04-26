"""FastAPI entrypoint for DAGBoard."""

from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from dag_studio.baselines import list_algorithm_catalog
from dag_studio.jobs import JobManager
from dag_studio.node_types import list_node_types
from dag_studio.schemas import ArtifactRecord, RunEvent, RunManifest, RunOptions, RunStartResponse, WorkflowDefinition
from dag_studio.storage import LocalStudioStorage


storage = LocalStudioStorage()
jobs = JobManager(storage=storage)

app = FastAPI(title="DAGBoard", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "dagboard"}


@app.get("/api/algorithms")
def algorithms() -> list[dict]:
    rows = list_algorithm_catalog()
    return [
        row
        for row in rows
        if row.get("registered") and row.get("supports_standard_tabular", True)
    ]


@app.get("/api/node-types")
def node_types() -> list[dict]:
    return list_node_types()


@app.get("/api/workflows")
def workflows() -> list[dict]:
    return storage.list_workflows()


@app.post("/api/workflows")
def save_workflow(workflow: WorkflowDefinition) -> WorkflowDefinition:
    try:
        return storage.save_workflow(workflow)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/workflows/{workflow_id}")
def get_workflow(workflow_id: str) -> WorkflowDefinition:
    try:
        return storage.load_workflow(workflow_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/workflows/{workflow_id}/run")
def run_workflow(workflow_id: str, options: Optional[RunOptions] = Body(default=None)) -> RunStartResponse:
    try:
        workflow = storage.load_workflow(workflow_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return jobs.start_run(workflow, options)


@app.get("/api/runs")
def list_runs() -> list[dict]:
    return jobs.list_runs()


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> RunManifest:
    try:
        return jobs.get_run(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/events", response_model=list[RunEvent])
def get_run_events(
    run_id: str,
    after: Optional[int] = Query(default=None, ge=-1),
    level: Optional[str] = None,
    node_id: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[RunEvent]:
    try:
        return jobs.list_events(
            run_id,
            after=after,
            level=level,
            node_id=node_id,
            event_type=event_type,
            limit=limit,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/events.jsonl", response_class=PlainTextResponse)
def get_run_events_jsonl(
    run_id: str,
    after: Optional[int] = Query(default=None, ge=-1),
    level: Optional[str] = None,
    node_id: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = Query(default=5000, ge=1, le=5000),
) -> PlainTextResponse:
    events = get_run_events(
        run_id,
        after=after,
        level=level,
        node_id=node_id,
        event_type=event_type,
        limit=limit,
    )
    body = "".join(json.dumps(event.model_dump(mode="json"), ensure_ascii=False) + "\n" for event in events)
    return PlainTextResponse(body, media_type="application/x-ndjson")


@app.get("/api/runs/{run_id}/artifacts", response_model=list[ArtifactRecord])
def list_artifacts(
    run_id: str,
    node_id: Optional[str] = None,
    kind: Optional[str] = None,
    output_kind: Optional[str] = None,
) -> list[ArtifactRecord]:
    try:
        return storage.list_artifacts(
            run_id,
            node_id=node_id,
            kind=kind,
            output_kind=output_kind,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/artifacts/{artifact_id}/preview")
def preview_artifact(
    run_id: str,
    artifact_id: str,
    array: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    rows: Optional[int] = Query(default=None, ge=1, le=500),
    cols: Optional[int] = Query(default=None, ge=1, le=500),
) -> dict:
    try:
        row_limit = rows if rows is not None else limit
        return storage.preview_artifact(
            run_id,
            artifact_id,
            array=array,
            limit=row_limit,
            offset=offset,
            cols=cols,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/artifacts/{artifact_id}")
def read_artifact(run_id: str, artifact_id: str) -> dict:
    try:
        return storage.read_artifact(run_id, artifact_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.websocket("/api/runs/{run_id}/events")
async def run_events(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    last_index = -1
    try:
        while True:
            try:
                manifest = jobs.get_run(run_id)
            except (FileNotFoundError, ValueError):
                await websocket.send_json({"event": "error", "payload": {"error": "run not found"}})
                await websocket.close()
                return

            for event in jobs.get_events_after(run_id, last_index):
                if event.index > last_index:
                    await websocket.send_json(event.model_dump(mode="json"))
                    last_index = event.index

            if manifest.status in {"completed", "failed"} and last_index >= len(manifest.events) - 1:
                await websocket.close()
                return
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return
