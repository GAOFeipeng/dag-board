"""Pydantic schemas shared by DAGBoard API and execution."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


NodeStatus = Literal["idle", "queued", "blocked", "running", "success", "failed", "skipped"]
RunStatus = Literal["queued", "running", "completed", "failed"]
EventLevel = Literal["debug", "info", "warn", "error", "fatal"]


class StudioPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


class WorkflowNode(BaseModel):
    """A visual workflow node."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: str
    type: str = Field(..., description="Execution node type.")
    position: StudioPosition = Field(default_factory=StudioPosition)
    data: Dict[str, Any] = Field(default_factory=dict)


class WorkflowEdge(BaseModel):
    """A visual workflow edge connecting two execution nodes."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: Optional[str] = None
    source: str
    target: str
    source_handle: Optional[str] = Field(default=None, alias="sourceHandle")
    target_handle: Optional[str] = Field(default=None, alias="targetHandle")


class WorkflowDefinition(BaseModel):
    """Serializable workflow definition."""

    id: Optional[str] = None
    name: str = "Untitled workflow"
    description: str = ""
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RunOptions(BaseModel):
    """Runtime options for a workflow execution."""

    model_config = ConfigDict(extra="allow")

    target_node_id: Optional[str] = None
    target_node_ids: List[str] = Field(default_factory=list)
    disabled_node_ids: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def normalize_target_node_id(self) -> "RunOptions":
        if self.target_node_id is None and self.target_node_ids:
            self.target_node_id = self.target_node_ids[0]
        return self


class NodeField(BaseModel):
    name: str
    label: str
    kind: Literal["string", "number", "integer", "boolean", "select", "json"]
    default: Any = None
    options: List[Any] = Field(default_factory=list)
    description: str = ""


class NodePort(BaseModel):
    id: str
    label: str
    kind: str
    required: bool = True
    min_count: int = 1
    max_count: Optional[int] = 1


class NodePreviewDefinition(BaseModel):
    enabled_by_default: bool = False
    supported_outputs: List[str] = Field(default_factory=list)


class NodeTypeDefinition(BaseModel):
    id: str
    label: str
    description: str
    inputs: List[str] = Field(default_factory=list)
    outputs: List[str] = Field(default_factory=list)
    fields: List[NodeField] = Field(default_factory=list)
    input_ports: List[NodePort] = Field(default_factory=list)
    output_ports: List[NodePort] = Field(default_factory=list)
    preview: NodePreviewDefinition = Field(default_factory=NodePreviewDefinition)
    inline_fields: List[str] = Field(default_factory=list)


class ArtifactRef(BaseModel):
    kind: str
    path: str
    artifact_id: Optional[str] = None
    output_kind: Optional[str] = None


class ArtifactRecord(BaseModel):
    artifact_id: str
    run_id: str
    node_id: Optional[str] = None
    node_type: Optional[str] = None
    output_kind: Optional[str] = None
    name: str
    kind: Literal["json", "npz"]
    rel_path: str
    size: int = 0
    created_at: datetime
    summary: Dict[str, Any] = Field(default_factory=dict)
    arrays: Dict[str, Any] = Field(default_factory=dict)


class NodeRunRecord(BaseModel):
    node_id: str
    node_type: str
    status: NodeStatus = "idle"
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    outputs: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class RunEvent(BaseModel):
    index: int
    event: str
    run_id: str
    timestamp: datetime
    level: EventLevel = "info"
    type: str = ""
    category: str = "lifecycle"
    message: str = ""
    node_id: Optional[str] = None
    node_type: Optional[str] = None
    duration_ms: Optional[float] = None
    artifact_refs: List[Dict[str, Any]] = Field(default_factory=list)
    detail: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class RunManifest(BaseModel):
    run_id: str
    workflow_id: str
    workflow_name: str
    status: RunStatus
    run_dir: str
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    node_states: Dict[str, NodeRunRecord] = Field(default_factory=dict)
    events: List[RunEvent] = Field(default_factory=list)
    options: RunOptions = Field(default_factory=RunOptions)
    error: Optional[str] = None


class RunStartResponse(BaseModel):
    run_id: str
    workflow_id: str
    status: RunStatus
