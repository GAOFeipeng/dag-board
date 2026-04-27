"""FastAPI entrypoint for DAGBoard."""

from __future__ import annotations

import asyncio
import csv
import html
import io
import json
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
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


@app.post("/api/imports")
async def upload_import(file: UploadFile) -> dict:
    try:
        content = await file.read()
        return storage.save_import_file(file.filename or "import.dat", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/imports")
def list_imports() -> list[dict]:
    return storage.list_imports()


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


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> RunManifest:
    try:
        return jobs.cancel_run(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/run-compare")
def compare_runs(run_ids: list[str] = Query(default=[])) -> dict:
    try:
        return _compare_runs(run_ids)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/run-compare/export.csv", response_class=PlainTextResponse)
def export_run_compare_csv(run_ids: list[str] = Query(default=[])) -> PlainTextResponse:
    payload = compare_runs(run_ids)
    rows = payload.get("rows", [])
    columns = sorted({key for row in rows for key in row.keys()}) if isinstance(rows, list) else []
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in columns})
    return PlainTextResponse(buffer.getvalue(), media_type="text/csv")


@app.post("/api/reports/from-run/{run_id}")
def report_from_run(run_id: str) -> dict:
    try:
        manifest = jobs.get_run(run_id)
        run_dir = Path(manifest.run_dir)
        markdown, html_text = _render_run_report(manifest)
        md_ref = storage.write_artifact_text(run_dir, "run_report", markdown, kind="md", output_kind="report", summary={"run_id": run_id})
        html_ref = storage.write_artifact_text(run_dir, "run_report", html_text, kind="html", output_kind="report", summary={"run_id": run_id})
        report = {"run_id": run_id, "markdown": md_ref, "html": html_ref}
        report["artifact_ref"] = storage.write_artifact_json(run_dir, "run_report_manifest", report, output_kind="report", summary={"run_id": run_id})
        return report
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

            if manifest.status in {"completed", "failed", "cancelled"} and last_index >= len(manifest.events) - 1:
                await websocket.close()
                return
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return


def _compare_runs(run_ids: list[str]) -> dict:
    rows: list[dict] = []
    for run_id in run_ids:
        manifest = jobs.get_run(run_id)
        for node_id, record in manifest.node_states.items():
            output = record.outputs or {}
            summary = output.get("evaluation_summary") if isinstance(output.get("evaluation_summary"), dict) else None
            evaluation = output.get("evaluation") if isinstance(output.get("evaluation"), dict) else None
            if summary and isinstance(summary.get("rows"), list):
                for row in summary["rows"]:
                    if isinstance(row, dict):
                        rows.append({"run_id": run_id, "workflow_name": manifest.workflow_name, "node_id": node_id, **row})
            if evaluation and isinstance(evaluation.get("metrics"), dict):
                rows.append({"run_id": run_id, "workflow_name": manifest.workflow_name, "node_id": node_id, **evaluation["metrics"]})
    return {"run_ids": run_ids, "rows": rows, "row_count": len(rows)}


def _render_run_report(manifest: RunManifest) -> tuple[str, str]:
    lines = [
        f"# DAGBoard Run Report",
        "",
        f"- Run: `{manifest.run_id}`",
        f"- Workflow: `{manifest.workflow_name}`",
        f"- Status: `{manifest.status}`",
        "",
        "## Events",
    ]
    for event in manifest.events[-100:]:
        lines.append(f"- {event.timestamp.isoformat()} `{event.type or event.event}` {event.message}")
    lines.append("")
    lines.append("## Node Outputs")
    for node_id, record in manifest.node_states.items():
        lines.append(f"### {node_id}")
        lines.append(f"- Type: `{record.node_type}`")
        lines.append(f"- Status: `{record.status}`")
        output = record.outputs or {}
        if isinstance(output.get("evaluation_summary"), dict):
            lines.append("```json")
            lines.append(json.dumps(output["evaluation_summary"].get("rows", []), ensure_ascii=False, indent=2)[:4000])
            lines.append("```")
        elif isinstance(output.get("evaluation"), dict):
            lines.append("```json")
            lines.append(json.dumps(output["evaluation"].get("metrics", {}), ensure_ascii=False, indent=2))
            lines.append("```")
    markdown = "\n".join(lines) + "\n"
    html_body = "".join(f"<p>{html.escape(line)}</p>" for line in markdown.splitlines())
    return markdown, f"<!doctype html><html><head><meta charset='utf-8'><title>DAGBoard Report</title></head><body>{html_body}</body></html>"
