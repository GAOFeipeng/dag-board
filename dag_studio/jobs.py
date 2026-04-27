"""In-memory run manager for local DAGBoard."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional

from dag_studio.execution import WorkflowCancelledError, WorkflowExecutionError, WorkflowExecutor
from dag_studio.schemas import RunEvent, RunManifest, RunOptions, RunStartResponse, WorkflowDefinition
from dag_studio.storage import LocalStudioStorage, utc_now


class JobManager:
    """Manage local workflow runs and event history."""

    def __init__(self, storage: Optional[LocalStudioStorage] = None, max_workers: int = 4):
        self.storage = storage or LocalStudioStorage()
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="dagboard")
        self._runs: Dict[str, RunManifest] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()

    def start_run(self, workflow: WorkflowDefinition, options: Optional[RunOptions] = None) -> RunStartResponse:
        options = options or RunOptions()
        if workflow.id is None:
            workflow = self.storage.save_workflow(workflow)
        run_id, run_dir = self.storage.create_run_dir(workflow.id)
        manifest = RunManifest(
            run_id=run_id,
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            status="queued",
            run_dir=str(run_dir),
            started_at=utc_now(),
            options=options,
        )
        with self._lock:
            self._runs[run_id] = manifest
        self._emit(
            run_id,
            "queued",
            {
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "target_node_id": options.target_node_id,
                "disabled_node_ids": options.disabled_node_ids,
            },
        )
        self.storage.write_json(Path(run_dir) / "workflow.json", workflow.model_dump(mode="json"))
        self.storage.save_run_manifest(manifest)
        self.executor.submit(self._run_workflow, run_id, workflow, run_dir, options)
        return RunStartResponse(run_id=run_id, workflow_id=workflow.id, status="queued")

    def get_run(self, run_id: str) -> RunManifest:
        with self._lock:
            manifest = self._runs.get(run_id)
        if manifest is not None:
            return manifest
        return self.storage.load_run_manifest(run_id)

    def get_events_after(self, run_id: str, index: int) -> list[RunEvent]:
        return self.list_events(run_id, after=index)

    def list_runs(self) -> list[dict]:
        with self._lock:
            active = {
                run_id: manifest.model_dump(mode="json", exclude={"events", "node_states"})
                for run_id, manifest in self._runs.items()
            }
        stored = {row["run_id"]: row for row in self.storage.list_runs() if row.get("run_id")}
        stored.update(active)
        return sorted(stored.values(), key=lambda row: str(row.get("started_at") or ""), reverse=True)

    def list_events(
        self,
        run_id: str,
        *,
        after: Optional[int] = None,
        level: Optional[str] = None,
        node_id: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 500,
    ) -> list[RunEvent]:
        try:
            return self.storage.read_events(
                run_id,
                after=after,
                level=level,
                node_id=node_id,
                event_type=event_type,
                limit=limit,
            )
        except FileNotFoundError:
            manifest = self.get_run(run_id)
            events = manifest.events
            if after is not None:
                events = [event for event in events if event.index > after]
            return events[-limit:]

    def _run_workflow(self, run_id: str, workflow: WorkflowDefinition, run_dir: Path, options: RunOptions) -> None:
        try:
            self._set_status(run_id, "running")
            self._emit(run_id, "running", {"target_node_id": options.target_node_id})
            executor = WorkflowExecutor(
                storage=self.storage,
                run_dir=run_dir,
                emit=lambda event, payload: self._emit(run_id, event, payload),
                target_node_id=options.target_node_id,
                disabled_node_ids=options.disabled_node_ids,
                cancel_checker=lambda: self.is_cancelled(run_id),
                timeout_sec=options.timeout_sec,
                node_timeout_sec=options.node_timeout_sec,
            )
            records = executor.execute(workflow)
            with self._lock:
                manifest = self._runs[run_id]
                manifest.node_states = records
                manifest.status = "completed"
                manifest.finished_at = utc_now()
            self._emit(run_id, "completed", {"node_counts": _node_counts(records)})
        except WorkflowCancelledError as exc:
            with self._lock:
                manifest = self._runs[run_id]
                manifest.node_states = exc.records
                manifest.status = "cancelled"
                manifest.error = str(exc)
                manifest.finished_at = utc_now()
            self._emit(run_id, "cancelled", {"error": str(exc), "node_counts": _node_counts(exc.records)})
        except WorkflowExecutionError as exc:
            with self._lock:
                manifest = self._runs[run_id]
                manifest.node_states = exc.records
                manifest.status = "failed"
                manifest.error = str(exc)
                manifest.finished_at = utc_now()
            self._emit(run_id, "failed", {"error": str(exc), "node_counts": _node_counts(exc.records)})
        except Exception as exc:
            with self._lock:
                manifest = self._runs[run_id]
                manifest.status = "failed"
                manifest.error = str(exc)
                manifest.finished_at = utc_now()
            self._emit(run_id, "failed", {"error": str(exc)})
        finally:
            with self._lock:
                manifest = self._runs[run_id]
            self.storage.save_run_manifest(manifest)

    def cancel_run(self, run_id: str) -> RunManifest:
        with self._lock:
            manifest = self._runs.get(run_id)
            active = manifest is not None
            if manifest is None:
                manifest = self.storage.load_run_manifest(run_id)
            if manifest.status in {"completed", "failed", "cancelled"}:
                return manifest
            if not active:
                return manifest
            self._cancelled.add(run_id)
        self._emit(run_id, "cancel_requested", {"run_id": run_id})
        return self.get_run(run_id)

    def is_cancelled(self, run_id: str) -> bool:
        with self._lock:
            return run_id in self._cancelled

    def _set_status(self, run_id: str, status: str) -> None:
        with self._lock:
            manifest = self._runs[run_id]
            manifest.status = status  # type: ignore[assignment]
            self.storage.save_run_manifest(manifest)

    def _emit(self, run_id: str, event: str, payload: dict) -> RunEvent:
        with self._lock:
            manifest = self._runs[run_id]
            level, category, event_type, message = _event_metadata(event, payload)
            item = RunEvent(
                index=len(manifest.events),
                event=event,
                run_id=run_id,
                timestamp=utc_now(),
                level=level,
                type=event_type,
                category=category,
                message=message,
                node_id=payload.get("node_id"),
                node_type=payload.get("node_type"),
                duration_ms=payload.get("duration_ms"),
                artifact_refs=list(payload.get("artifact_refs") or []),
                detail=payload.get("detail") or payload.get("error"),
                payload=payload,
            )
            manifest.events.append(item)
            self.storage.append_event(Path(manifest.run_dir), item)
            self.storage.save_run_manifest(manifest)
            return item


def _node_counts(records: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records.values():
        status = getattr(record, "status", None)
        counts[str(status)] = counts.get(str(status), 0) + 1
    return counts


def _event_metadata(event: str, payload: dict) -> tuple[str, str, str, str]:
    node_id = payload.get("node_id")
    event_type = event.replace("_", ".")
    if event in {"queued", "running", "completed", "failed", "cancelled"}:
        event_type = f"run.{event}"
    category = "lifecycle"
    level = "info"
    if event in {"node_failed", "failed"}:
        level = "error"
    elif event in {"node_warning", "node_blocked", "cancel_requested", "node_cancelled"}:
        level = "warn"
    if event in {"node_skipped", "node_blocked"}:
        category = "validation"
    if event.startswith("node_") and category != "validation":
        category = "lifecycle"
    messages = {
        "queued": "Run queued.",
        "running": "Run started.",
        "completed": "Run completed.",
        "cancel_requested": "Run cancellation requested.",
        "cancelled": "Run cancelled.",
        "failed": f"Run failed: {payload.get('error', 'unknown error')}",
        "node_started": f"Node {node_id} started.",
        "node_completed": f"Node {node_id} completed.",
        "node_failed": f"Node {node_id} failed: {payload.get('error', 'unknown error')}",
        "node_warning": f"Node {node_id} warning: {payload.get('warning', '')}",
        "node_skipped": f"Node {node_id} skipped: {payload.get('reason', '')}",
        "node_cancelled": f"Node {node_id} cancelled.",
        "node_blocked": f"Node {node_id} blocked by upstream inputs.",
    }
    return level, category, event_type, messages.get(event, event_type)
