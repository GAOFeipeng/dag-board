import type { Edge, Node } from '@xyflow/react';

export type NodeStatus = 'idle' | 'queued' | 'blocked' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type NodeField = {
  name: string;
  label: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'select' | 'json';
  default: unknown;
  options: unknown[];
  description?: string;
  placeholder?: string;
};

export type NodePort = {
  id: string;
  label: string;
  kind: string;
  required?: boolean;
  min_count?: number;
  max_count?: number | null;
};

export type NodePreviewDefinition = {
  enabled_by_default?: boolean;
  supported_outputs?: string[];
};

export type NodeTypeDefinition = {
  id: string;
  label: string;
  description: string;
  inputs: string[];
  outputs: string[];
  fields: NodeField[];
  input_ports?: NodePort[];
  output_ports?: NodePort[];
  preview?: NodePreviewDefinition;
  inline_fields?: string[];
};

export type AlgorithmRow = {
  name: string;
  tier: string;
  provider: string;
  origin: string;
  category: string;
  note?: string;
};

export type StudioNodeData = {
  label: string;
  nodeType: string;
  params: Record<string, unknown>;
  status?: NodeStatus;
  disabled?: boolean;
  previewCollapsed?: boolean;
  inputStatus?: NodeInputStatus;
  inlineFields?: NodeField[];
  inputPorts?: NodePort[];
  outputPorts?: NodePort[];
  previewOutput?: Record<string, unknown> | null;
  showPreview?: boolean;
  onInlineParamChange?: (nodeId: string, fieldName: string, value: unknown) => void;
  onTogglePreview?: (nodeId: string) => void;
};

export type StudioNode = Node<StudioNodeData, 'studio'>;
export type StudioEdge = Edge;

export type NodeInputStatus = {
  required: number;
  satisfied: number;
  missing: string[];
};

export type WorkflowPayload = {
  id?: string;
  name: string;
  description?: string;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  metadata?: Record<string, unknown>;
};

export type RunEvent = {
  index: number;
  event: string;
  run_id: string;
  timestamp: string;
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  type?: string;
  category?: string;
  message?: string;
  node_id?: string | null;
  node_type?: string | null;
  duration_ms?: number | null;
  artifact_refs?: Record<string, unknown>[];
  detail?: string | null;
  payload: Record<string, unknown>;
};

export type RunOptions = {
  target_node_id?: string | null;
  target_node_ids?: string[];
  disabled_node_ids?: string[];
  timeout_sec?: number | null;
  node_timeout_sec?: number | null;
};

export type ArtifactRecord = {
  artifact_id: string;
  run_id: string;
  node_id?: string | null;
  node_type?: string | null;
  output_kind?: string | null;
  name: string;
  kind: 'json' | 'npz' | 'csv' | 'md' | 'html';
  rel_path: string;
  size: number;
  created_at: string;
  summary: Record<string, unknown>;
  arrays?: Record<string, unknown>;
};

export type ImportRecord = {
  import_id: string;
  filename: string;
  suffix: string;
  size: number;
  created_at: string;
  path?: string;
};

export type RunCompareRow = Record<string, unknown> & {
  run_id?: string;
  workflow_name?: string;
  node_id?: string;
  algorithm?: string;
  seed?: unknown;
  runtime?: number;
};

export type RunComparePayload = {
  run_ids: string[];
  rows: RunCompareRow[];
  row_count: number;
};

export type RunManifest = {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  status: RunStatus;
  run_dir: string;
  node_states: Record<string, NodeRunRecord>;
  events: RunEvent[];
  error?: string | null;
};

export type NodeRunRecord = {
  node_id: string;
  node_type: string;
  status: NodeStatus;
  outputs: Record<string, unknown>;
  warnings: string[];
  error?: string | null;
};
