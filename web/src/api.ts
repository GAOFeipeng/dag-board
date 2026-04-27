import type {
  AlgorithmRow,
  ArtifactRecord,
  ImportRecord,
  NodeTypeDefinition,
  RunComparePayload,
  RunEvent,
  RunManifest,
  RunOptions,
  WorkflowPayload,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  nodeTypes: () => getJson<NodeTypeDefinition[]>('/api/node-types'),
  algorithms: () => getJson<AlgorithmRow[]>('/api/algorithms'),
  workflows: () => getJson<WorkflowPayload[]>('/api/workflows'),
  getWorkflow: (workflowId: string) => getJson<WorkflowPayload>(`/api/workflows/${workflowId}`),
  saveWorkflow: (workflow: WorkflowPayload) => postJson<WorkflowPayload>('/api/workflows', workflow),
  startRun: (workflowId: string, options?: RunOptions) =>
    postJson<{ run_id: string; workflow_id: string; status: string }>(`/api/workflows/${workflowId}/run`, options),
  imports: () => getJson<ImportRecord[]>('/api/imports'),
  uploadImport: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${API_BASE}/api/imports`, { method: 'POST', body: form });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${detail}`);
    }
    return response.json() as Promise<ImportRecord>;
  },
  runs: () => getJson<Array<Record<string, unknown>>>('/api/runs'),
  getRun: (runId: string) => getJson<RunManifest>(`/api/runs/${runId}`),
  cancelRun: (runId: string) => postJson<RunManifest>(`/api/runs/${runId}/cancel`),
  runCompare: (runIds: string[]) => {
    const query = new URLSearchParams();
    runIds.forEach((runId) => query.append('run_ids', runId));
    return getJson<RunComparePayload>(`/api/run-compare?${query}`);
  },
  runCompareCsvUrl: (runIds: string[]) => {
    const query = new URLSearchParams();
    runIds.forEach((runId) => query.append('run_ids', runId));
    return `${API_BASE}/api/run-compare/export.csv?${query}`;
  },
  reportFromRun: (runId: string) => postJson<Record<string, unknown>>(`/api/reports/from-run/${runId}`),
  getEvents: (runId: string, after?: number) => getJson<RunEvent[]>(`/api/runs/${runId}/events${after !== undefined ? `?after=${after}` : ''}`),
  artifacts: (runId: string, params?: { node_id?: string; kind?: string; output_kind?: string }) => {
    const query = new URLSearchParams();
    if (params?.node_id) query.set('node_id', params.node_id);
    if (params?.kind) query.set('kind', params.kind);
    if (params?.output_kind) query.set('output_kind', params.output_kind);
    return getJson<ArtifactRecord[]>(`/api/runs/${runId}/artifacts${query.size ? `?${query}` : ''}`);
  },
  artifact: (runId: string, artifactId: string) => getJson<Record<string, unknown>>(`/api/runs/${runId}/artifacts/${artifactId}`),
  artifactPreview: (runId: string, artifactId: string, params?: { array?: string; rows?: number; cols?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.array) query.set('array', params.array);
    if (params?.rows) query.set('rows', String(params.rows));
    if (params?.cols) query.set('cols', String(params.cols));
    if (params?.offset) query.set('offset', String(params.offset));
    return getJson<Record<string, unknown>>(`/api/runs/${runId}/artifacts/${artifactId}/preview${query.size ? `?${query}` : ''}`);
  },
  eventsUrl: (runId: string) => `${API_BASE.replace(/^http/, 'ws')}/api/runs/${runId}/events`,
};
