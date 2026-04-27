"""Local JSON/NPZ storage for DAGBoard."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from dag_studio.schemas import ArtifactRecord, RunEvent, RunManifest, WorkflowDefinition


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def jsonable(value: Any) -> Any:
    """Convert numpy and pydantic-adjacent values to JSON-safe objects."""

    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", text.strip()).strip("-")
    return cleaned or "workflow"


class LocalStudioStorage:
    """Filesystem-backed workflow and run storage."""

    def __init__(self, root: Optional[Path] = None):
        repo_root = Path(__file__).resolve().parents[1]
        self.root = Path(root) if root is not None else repo_root / "results" / "dagboard"
        self.workflows_dir = self.root / "workflows"
        self.runs_dir = self.root / "runs"
        self.imports_dir = self.root / "imports"
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.imports_dir.mkdir(parents=True, exist_ok=True)

    def save_workflow(self, workflow: WorkflowDefinition) -> WorkflowDefinition:
        now = utc_now()
        workflow_id = workflow.id or f"{slugify(workflow.name)}-{uuid.uuid4().hex[:8]}"
        self._validate_storage_id(workflow_id, "workflow id")
        saved = workflow.model_copy(
            update={
                "id": workflow_id,
                "created_at": workflow.created_at or now,
                "updated_at": now,
            }
        )
        path = self._workflow_path(workflow_id)
        self.write_json(path, saved.model_dump(mode="json"))
        return saved

    def list_workflows(self) -> list[dict]:
        workflows: list[dict] = []
        for path in sorted(self.workflows_dir.glob("*.json")):
            try:
                workflows.append(self.read_json(path))
            except json.JSONDecodeError:
                continue
        return workflows

    def load_workflow(self, workflow_id: str) -> WorkflowDefinition:
        path = self._workflow_path(workflow_id)
        if not path.exists():
            raise FileNotFoundError(f"Workflow not found: {workflow_id}")
        return WorkflowDefinition.model_validate(self.read_json(path))

    def create_run_dir(self, workflow_id: str) -> tuple[str, Path]:
        timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
        run_id = f"{slugify(workflow_id)}-{timestamp}-{uuid.uuid4().hex[:8]}"
        run_dir = self.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        (run_dir / "artifacts").mkdir()
        return run_id, run_dir

    def save_run_manifest(self, manifest: RunManifest) -> None:
        run_dir = self.resolve_run_dir(manifest.run_id)
        saved = manifest.model_copy(update={"run_dir": str(run_dir)})
        self.write_json(run_dir / "manifest.json", saved.model_dump(mode="json"))
        self.write_events_jsonl(run_dir, saved.events)

    def load_run_manifest(self, run_id: str) -> RunManifest:
        run_dir = self.resolve_run_dir(run_id)
        path = run_dir / "manifest.json"
        if not path.exists():
            raise FileNotFoundError(f"Run not found: {run_id}")
        manifest = RunManifest.model_validate(self.read_json(path))
        events = self._read_events_jsonl(run_dir)
        if len(events) > len(manifest.events):
            manifest = manifest.model_copy(update={"events": events})
        return manifest

    def list_runs(self) -> list[dict]:
        runs: list[dict] = []
        for path in sorted(self.runs_dir.glob("*/manifest.json"), reverse=True):
            try:
                manifest = self.read_json(path)
            except json.JSONDecodeError:
                continue
            runs.append(
                {
                    "run_id": manifest.get("run_id"),
                    "workflow_id": manifest.get("workflow_id"),
                    "workflow_name": manifest.get("workflow_name"),
                    "status": manifest.get("status"),
                    "started_at": manifest.get("started_at"),
                    "finished_at": manifest.get("finished_at"),
                    "error": manifest.get("error"),
                }
            )
        return runs

    def resolve_run_dir(self, run_id: str) -> Path:
        self._validate_storage_id(run_id, "run id")
        run_dir = (self.runs_dir / run_id).resolve()
        runs_root = self.runs_dir.resolve()
        self._ensure_under(runs_root, run_dir)
        if run_dir.is_dir():
            return run_dir
        raise FileNotFoundError(f"Run not found: {run_id}")

    def write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(jsonable(payload), indent=2, ensure_ascii=False), encoding="utf-8")

    def read_json(self, path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    def save_import_file(self, filename: str, content: bytes) -> dict:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".csv", ".npy", ".npz"}:
            raise ValueError("Unsupported import file type. Use CSV, NPY, or NPZ.")
        import_id = f"{slugify(Path(filename).stem)}-{uuid.uuid4().hex[:8]}"
        self._validate_storage_id(import_id, "import id")
        import_dir = self.imports_dir / import_id
        import_dir.mkdir(parents=True, exist_ok=False)
        safe_name = f"source{suffix}"
        path = import_dir / safe_name
        path.write_bytes(content)
        meta = {
            "import_id": import_id,
            "filename": filename,
            "suffix": suffix.lstrip("."),
            "rel_path": str(path.resolve().relative_to(self.root.resolve())),
            "size": path.stat().st_size,
            "created_at": utc_now().isoformat(),
        }
        self.write_json(import_dir / "import.json", meta)
        return meta

    def list_imports(self) -> list[dict]:
        rows: list[dict] = []
        for path in sorted(self.imports_dir.glob("*/import.json"), reverse=True):
            try:
                rows.append(self.read_json(path))
            except json.JSONDecodeError:
                continue
        return rows

    def get_import(self, import_id: str) -> dict:
        self._validate_storage_id(import_id, "import id")
        path = (self.imports_dir / import_id / "import.json").resolve()
        self._ensure_under(self.imports_dir.resolve(), path)
        if not path.exists():
            raise FileNotFoundError(f"Import not found: {import_id}")
        return self.read_json(path)

    def resolve_import_path(self, import_id: str) -> Path:
        meta = self.get_import(import_id)
        path = (self.root / str(meta["rel_path"])).resolve()
        self._ensure_under((self.imports_dir / import_id).resolve(), path)
        if not path.exists():
            raise FileNotFoundError(f"Import file not found: {import_id}")
        return path

    def write_npz(
        self,
        run_dir: Path,
        artifact_name: str,
        *,
        node_id: Optional[str] = None,
        node_type: Optional[str] = None,
        output_kind: Optional[str] = None,
        summary: Optional[Dict[str, Any]] = None,
        **arrays: np.ndarray,
    ) -> dict:
        run_dir = self._checked_run_dir_path(run_dir)
        artifacts_dir = run_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        safe_name = slugify(artifact_name)
        path = artifacts_dir / f"{safe_name}.npz"
        np.savez_compressed(path, **arrays)
        inferred_summary = summary or {
            key: matrix_summary(np.asarray(value)) for key, value in arrays.items()
        }
        record = self.register_artifact(
            run_dir=run_dir,
            path=path,
            name=safe_name,
            kind="npz",
            node_id=node_id,
            node_type=node_type,
            output_kind=output_kind,
            summary=inferred_summary,
        )
        return {
            "kind": "npz",
            "path": record.rel_path,
            "artifact_id": record.artifact_id,
            "output_kind": record.output_kind,
        }

    def write_artifact_json(
        self,
        run_dir: Path,
        artifact_name: str,
        payload: Dict[str, Any],
        *,
        node_id: Optional[str] = None,
        node_type: Optional[str] = None,
        output_kind: Optional[str] = None,
        summary: Optional[Dict[str, Any]] = None,
    ) -> dict:
        run_dir = self._checked_run_dir_path(run_dir)
        artifacts_dir = run_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        safe_name = slugify(artifact_name)
        path = artifacts_dir / f"{safe_name}.json"
        self.write_json(path, payload)
        record = self.register_artifact(
            run_dir=run_dir,
            path=path,
            name=safe_name,
            kind="json",
            node_id=node_id,
            node_type=node_type,
            output_kind=output_kind,
            summary=summary or summarize_json_payload(payload),
        )
        return {
            "kind": "json",
            "path": record.rel_path,
            "artifact_id": record.artifact_id,
            "output_kind": record.output_kind,
        }

    def write_artifact_text(
        self,
        run_dir: Path,
        artifact_name: str,
        text: str,
        *,
        kind: str,
        node_id: Optional[str] = None,
        node_type: Optional[str] = None,
        output_kind: Optional[str] = None,
        summary: Optional[Dict[str, Any]] = None,
    ) -> dict:
        if kind not in {"csv", "md", "html"}:
            raise ValueError(f"Unsupported text artifact kind: {kind}")
        run_dir = self._checked_run_dir_path(run_dir)
        artifacts_dir = run_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        safe_name = slugify(artifact_name)
        path = artifacts_dir / f"{safe_name}.{kind}"
        path.write_text(text, encoding="utf-8")
        record = self.register_artifact(
            run_dir=run_dir,
            path=path,
            name=safe_name,
            kind=kind,
            node_id=node_id,
            node_type=node_type,
            output_kind=output_kind,
            summary=summary or {},
        )
        return {
            "kind": kind,
            "path": record.rel_path,
            "artifact_id": record.artifact_id,
            "output_kind": record.output_kind,
        }

    def register_artifact(
        self,
        *,
        run_dir: Path,
        path: Path,
        name: str,
        kind: str,
        node_id: Optional[str],
        node_type: Optional[str],
        output_kind: Optional[str],
        summary: Optional[Dict[str, Any]] = None,
    ) -> ArtifactRecord:
        run_dir = self._checked_run_dir_path(run_dir)
        artifacts_dir = (run_dir / "artifacts").resolve()
        resolved = path.resolve()
        self._ensure_under(artifacts_dir, resolved)
        run_id = run_dir.name
        record = ArtifactRecord(
            artifact_id=f"{slugify(name)}-{uuid.uuid4().hex[:8]}",
            run_id=run_id,
            node_id=node_id,
            node_type=node_type,
            output_kind=output_kind,
            name=name,
            kind=kind,  # type: ignore[arg-type]
            rel_path=str(resolved.relative_to(self.root.resolve())),
            size=resolved.stat().st_size,
            created_at=utc_now(),
            summary=summary or {},
            arrays=(summary or {}) if kind == "npz" else {},
        )
        index_path = self._artifact_index_path(run_dir)
        records = self._read_artifact_index(run_dir) if index_path.exists() else []
        records.append(record)
        self.write_json(self._artifact_index_path(run_dir), [item.model_dump(mode="json") for item in records])
        return record

    def list_artifacts(
        self,
        run_id: str,
        *,
        node_id: Optional[str] = None,
        kind: Optional[str] = None,
        output_kind: Optional[str] = None,
    ) -> list[ArtifactRecord]:
        records = self._read_artifact_index(self.resolve_run_dir(run_id))
        if node_id is not None:
            records = [record for record in records if record.node_id == node_id]
        if kind is not None:
            records = [record for record in records if record.kind == kind]
        if output_kind is not None:
            records = [record for record in records if record.output_kind == output_kind]
        return records

    def read_artifact(self, run_id: str, artifact_id: str) -> dict:
        run_dir = self.resolve_run_dir(run_id)
        record = self.get_artifact(run_id, artifact_id)
        path = self._artifact_path(run_dir, record)
        if record.kind == "json":
            return {"artifact": record.model_dump(mode="json"), "content": self.read_json(path)}
        if record.kind == "npz":
            with np.load(path, allow_pickle=False) as data:
                arrays = {
                    key: {
                        "shape": list(data[key].shape),
                        "dtype": str(data[key].dtype),
                        "summary": matrix_summary(data[key]),
                    }
                    for key in data.files
                }
            return {"artifact": record.model_dump(mode="json"), "arrays": arrays}
        if record.kind in {"csv", "md", "html"}:
            return {"artifact": record.model_dump(mode="json"), "content": path.read_text(encoding="utf-8")}
        raise FileNotFoundError(f"Unsupported artifact kind: {record.kind}")

    def preview_artifact(
        self,
        run_id: str,
        artifact_id: str,
        *,
        array: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        cols: Optional[int] = None,
    ) -> dict:
        run_dir = self.resolve_run_dir(run_id)
        record = self.get_artifact(run_id, artifact_id)
        path = self._artifact_path(run_dir, record)
        if record.kind == "json":
            return {
                "artifact": record.model_dump(mode="json"),
                "summary": record.summary,
                "content": self.read_json(path),
            }
        if record.kind != "npz":
            raise ValueError(f"Unsupported artifact kind: {record.kind}")
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        with np.load(path, allow_pickle=False) as data:
            array_name = array or (data.files[0] if data.files else "")
            if array_name not in data.files:
                raise FileNotFoundError(f"Array not found in artifact: {array_name}")
            arr = np.asarray(data[array_name])
            if arr.ndim == 0:
                sliced = arr.reshape(1)
            elif arr.ndim == 1:
                sliced = arr[offset : offset + limit].reshape(-1, 1)
            else:
                sliced = arr[offset : offset + limit, :]
                if cols is not None:
                    sliced = sliced[:, : max(1, min(int(cols), 500))]
            values = jsonable(sliced)
            artifact = record.model_dump(mode="json")
            return {
                **artifact,
                "artifact": artifact,
                "array": array_name,
                "shape": list(arr.shape),
                "dtype": str(arr.dtype),
                "offset": offset,
                "limit": limit,
                "summary": matrix_summary(arr),
                "values": values,
                "data": values,
            }

    def get_artifact(self, run_id: str, artifact_id: str) -> ArtifactRecord:
        for record in self._read_artifact_index(self.resolve_run_dir(run_id)):
            if record.artifact_id == artifact_id:
                return record
        raise FileNotFoundError(f"Artifact not found: {artifact_id}")

    def append_event(self, run_dir: Path, event: RunEvent) -> None:
        run_dir = self._checked_run_dir_path(run_dir)
        path = run_dir / "events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(jsonable(event.model_dump(mode="json")), ensure_ascii=False))
            handle.write("\n")

    def write_events_jsonl(self, run_dir: Path, events: list[RunEvent]) -> None:
        run_dir = self._checked_run_dir_path(run_dir)
        lines = [
            json.dumps(jsonable(event.model_dump(mode="json")), ensure_ascii=False)
            for event in events
        ]
        text = "\n".join(lines)
        if text:
            text += "\n"
        (run_dir / "events.jsonl").write_text(text, encoding="utf-8")

    def read_events(
        self,
        run_id: str,
        *,
        after: Optional[int] = None,
        level: Optional[str] = None,
        node_id: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 500,
    ) -> list[RunEvent]:
        run_dir = self.resolve_run_dir(run_id)
        path = run_dir / "events.jsonl"
        if not path.exists():
            try:
                events = self.load_run_manifest(run_id).events
            except FileNotFoundError:
                events = []
        else:
            events = self._read_events_jsonl(run_dir)
        if after is not None:
            events = [event for event in events if event.index > after]
        if level is not None:
            events = [event for event in events if event.level == level]
        if node_id is not None:
            events = [event for event in events if event.node_id == node_id]
        if event_type is not None:
            events = [event for event in events if event.type == event_type or event.event == event_type]
        limit = max(1, min(int(limit), 5000))
        return events[-limit:]

    def _artifact_index_path(self, run_dir: Path) -> Path:
        return Path(run_dir) / "artifact_index.json"

    def _read_artifact_index(self, run_dir: Path) -> list[ArtifactRecord]:
        path = self._artifact_index_path(run_dir)
        if not path.exists():
            return self._scan_artifacts(run_dir)
        return [ArtifactRecord.model_validate(item) for item in self.read_json(path)]

    def _artifact_path(self, run_dir: Path, record: ArtifactRecord) -> Path:
        path = (self.root / record.rel_path).resolve()
        self._ensure_under((Path(run_dir) / "artifacts").resolve(), path)
        if not path.exists():
            raise FileNotFoundError(f"Artifact file not found: {record.artifact_id}")
        return path

    def _ensure_under(self, root: Path, path: Path) -> None:
        root = root.resolve()
        path = path.resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Requested path is outside the storage directory.") from exc

    def _validate_storage_id(self, value: str, label: str) -> None:
        if not value or value in {".", ".."}:
            raise ValueError(f"Invalid {label}: {value!r}")
        if "/" in value or "\\" in value or "\x00" in value:
            raise ValueError(f"Invalid {label}: {value!r}")
        if re.match(r"^[A-Za-z]:", value):
            raise ValueError(f"Invalid {label}: {value!r}")

    def _workflow_path(self, workflow_id: str) -> Path:
        self._validate_storage_id(workflow_id, "workflow id")
        path = (self.workflows_dir / f"{workflow_id}.json").resolve()
        self._ensure_under(self.workflows_dir.resolve(), path)
        return path

    def _checked_run_dir_path(self, run_dir: Path) -> Path:
        path = Path(run_dir).resolve()
        self._ensure_under(self.runs_dir.resolve(), path)
        if not path.is_dir():
            raise FileNotFoundError(f"Run not found: {path.name}")
        return path

    def _read_events_jsonl(self, run_dir: Path) -> list[RunEvent]:
        path = Path(run_dir) / "events.jsonl"
        if not path.exists():
            return []
        events: list[RunEvent] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(RunEvent.model_validate(json.loads(line)))
        return events

    def _scan_artifacts(self, run_dir: Path) -> list[ArtifactRecord]:
        run_dir = self._checked_run_dir_path(run_dir)
        artifacts_dir = run_dir / "artifacts"
        if not artifacts_dir.exists():
            return []
        records: list[ArtifactRecord] = []
        for path in sorted(artifacts_dir.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in {".json", ".npz", ".csv", ".md", ".html"}:
                continue
            kind = path.suffix.lower().lstrip(".")
            stat = path.stat()
            name = path.stem
            summary: Dict[str, Any] = {}
            try:
                if kind == "json":
                    payload = self.read_json(path)
                    if isinstance(payload, dict):
                        summary = summarize_json_payload(payload)
                elif kind == "npz":
                    with np.load(path, allow_pickle=False) as data:
                        summary = {key: matrix_summary(data[key]) for key in data.files}
            except (json.JSONDecodeError, OSError, ValueError):
                summary = {}
            records.append(
                ArtifactRecord(
                    artifact_id=slugify(name),
                    run_id=run_dir.name,
                    name=name,
                    kind=kind,  # type: ignore[arg-type]
                    rel_path=str(path.resolve().relative_to(self.root.resolve())),
                    size=stat.st_size,
                    created_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
                    summary=summary,
                    arrays=summary if kind == "npz" else {},
                )
            )
        return records


def matrix_summary(matrix: np.ndarray, ref: Optional[dict] = None) -> dict:
    arr = np.asarray(matrix)
    finite = arr[np.isfinite(arr)]
    summary = {
        "shape": list(arr.shape),
        "nnz": int(np.count_nonzero(arr)),
        "dtype": str(arr.dtype),
    }
    if finite.size:
        summary.update(
            {
                "min": float(np.min(finite)),
                "max": float(np.max(finite)),
                "mean": float(np.mean(finite)),
            }
        )
    if ref is not None:
        summary["ref"] = ref
    return summary


def summarize_json_payload(payload: Dict[str, Any]) -> dict:
    summary: dict[str, Any] = {"keys": sorted(str(key) for key in payload.keys())[:20]}
    if "metrics" in payload and isinstance(payload["metrics"], dict):
        summary["metrics"] = payload["metrics"]
    if "graph_meta" in payload and isinstance(payload["graph_meta"], dict):
        summary["graph_meta"] = payload["graph_meta"]
    if "render_meta" in payload and isinstance(payload["render_meta"], dict):
        summary["render_meta"] = payload["render_meta"]
    if "data_meta" in payload and isinstance(payload["data_meta"], dict):
        summary["data_meta"] = payload["data_meta"]
    if "matrix_summary" in payload and isinstance(payload["matrix_summary"], dict):
        summary["matrix_summary"] = payload["matrix_summary"]
    return summary
