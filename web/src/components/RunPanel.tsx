import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Files, Filter, Loader2, ScrollText, Search } from 'lucide-react';
import type { ArtifactRecord, RunEvent } from '../types';

type JsonRecord = Record<string, unknown>;
type RunPanelTab = 'logs' | 'outputs' | 'artifacts';

export type ExtendedRunEvent = Partial<Omit<RunEvent, 'payload'>> & {
  payload?: JsonRecord | null;
};

export type ExtendedNodeRunRecord = {
  status?: string | null;
  node_type?: string | null;
  nodeType?: string | null;
  outputs?: JsonRecord | null;
  warnings?: unknown;
  error?: unknown;
};

export type ExtendedRunManifest = {
  run_id?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  status?: string | null;
  run_dir?: string | null;
  node_states?: Record<string, ExtendedNodeRunRecord | null | undefined> | null;
  events?: ExtendedRunEvent[] | null;
};

export type ArtifactItem = {
  id: string;
  nodeId: string;
  label: string;
  kind?: string;
  path?: string;
  source: string;
  value: unknown;
};

export type RunPanelProps = {
  events: ExtendedRunEvent[];
  runStatus: string;
  nodeOutputs: Record<string, JsonRecord | undefined>;
  selectedNodeId: string | null;
  manifest?: ExtendedRunManifest | null;
  artifacts?: ArtifactRecord[];
  onOpenArtifact?: (artifact: ArtifactItem) => void;
};

type OutputEntry = {
  nodeId: string;
  output: JsonRecord;
  status?: string;
  nodeType?: string;
};

const tabs: Array<{ id: RunPanelTab; label: string }> = [
  { id: 'logs', label: 'Logs' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'artifacts', label: 'Artifacts' },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join(' ');
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${safeText(item)}`)
      .filter(Boolean)
      .join(' ');
  }
  return String(value);
}

function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return safeText(value);
  }
}

function eventName(event: ExtendedRunEvent): string {
  return typeof event.event === 'string' && event.event ? event.event : 'event';
}

function eventNodeId(event: ExtendedRunEvent): string | null {
  const payload = event.payload;
  if (!isRecord(payload)) return null;
  for (const key of ['node_id', 'nodeId', 'source', 'target']) {
    const value = payload[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function eventMessage(event: ExtendedRunEvent): string {
  const payload = event.payload;
  if (!isRecord(payload)) return '';
  for (const key of ['node_id', 'nodeId', 'error', 'message', 'detail']) {
    const value = payload[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function metricRows(output: JsonRecord | undefined) {
  const evaluation = isRecord(output?.evaluation) ? output.evaluation : undefined;
  const metrics = isRecord(evaluation?.metrics) ? evaluation.metrics : undefined;
  return Object.entries(metrics ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
}

function outputKind(output: JsonRecord): string {
  const kind = output.kind;
  if (typeof kind === 'string' && kind) return kind;
  for (const key of Object.keys(output)) {
    if (key.endsWith('_result') || key.endsWith('_view') || key === 'graph' || key === 'data' || key === 'evaluation') {
      return key;
    }
  }
  return 'output';
}

function collectOutputs(nodeOutputs: Record<string, JsonRecord | undefined>, manifest?: ExtendedRunManifest | null): OutputEntry[] {
  const rows = new Map<string, OutputEntry>();
  const nodeStates = manifest?.node_states;
  if (isRecord(nodeStates)) {
    for (const [nodeId, record] of Object.entries(nodeStates)) {
      if (!isRecord(record) || !isRecord(record.outputs)) continue;
      rows.set(nodeId, {
        nodeId,
        output: record.outputs,
        status: typeof record.status === 'string' ? record.status : undefined,
        nodeType:
          typeof record.node_type === 'string'
            ? record.node_type
            : typeof record.nodeType === 'string'
              ? record.nodeType
              : undefined,
      });
    }
  }
  for (const [nodeId, output] of Object.entries(nodeOutputs)) {
    if (!isRecord(output)) continue;
    rows.set(nodeId, { ...rows.get(nodeId), nodeId, output });
  }
  return [...rows.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function collectArtifactsFromValue(
  value: unknown,
  nodeId: string,
  trail: string[],
  artifacts: ArtifactItem[],
  seen: WeakSet<object>,
  depth = 0,
) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => collectArtifactsFromValue(item, nodeId, [...trail, String(index)], artifacts, seen, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  const artifactPath = typeof value.path === 'string' ? value.path : undefined;
  if (artifactPath) {
    const source = trail.join('.') || 'output';
    const kind = typeof value.kind === 'string' ? value.kind : undefined;
    const label = kind ? `${kind} artifact` : source;
    artifacts.push({
      id: `${nodeId}:${source}:${artifactPath}`,
      nodeId,
      label,
      kind,
      path: artifactPath,
      source,
      value,
    });
  }

  for (const [key, item] of Object.entries(value)) {
    collectArtifactsFromValue(item, nodeId, [...trail, key], artifacts, seen, depth + 1);
  }
}

function collectArtifacts(outputs: OutputEntry[], records: ArtifactRecord[] = []): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  for (const entry of outputs) {
    collectArtifactsFromValue(entry.output, entry.nodeId, [], artifacts, new WeakSet<object>());
  }
  for (const record of records) {
    artifacts.push({
      id: record.artifact_id,
      nodeId: record.node_id ?? 'run',
      label: record.name,
      kind: record.kind,
      path: record.rel_path,
      source: record.output_kind ?? record.kind,
      value: record,
    });
  }
  return artifacts;
}

function matchesFilter(text: string, filter: string): boolean {
  const normalized = filter.trim().toLowerCase();
  return !normalized || text.toLowerCase().includes(normalized);
}

function activeIcon(runStatus: string) {
  if (runStatus === 'running' || runStatus === 'queued') return <Loader2 size={15} className="spin" />;
  if (runStatus === 'failed') return <AlertTriangle size={15} />;
  return <Activity size={15} />;
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minHeight: 30,
        padding: '0 9px',
        borderColor: active ? '#80c7f4' : undefined,
        background: active ? '#25313a' : undefined,
      }}
    >
      {label}
    </button>
  );
}

function FilterBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 5, color: '#c8d1d5', fontSize: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Search size={13} />
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter"
        style={{
          width: '100%',
          minHeight: 30,
          border: '1px solid #384148',
          borderRadius: 6,
          background: '#111416',
          color: '#edf2f4',
          padding: '0 8px',
        }}
      />
    </label>
  );
}

function FocusToggle({
  selectedNodeId,
  checked,
  onChange,
}: {
  selectedNodeId: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#c8d1d5', fontSize: 12 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectedNodeId}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 15, height: 15 }}
      />
      <span>{selectedNodeId ? `Focus ${selectedNodeId}` : 'Select a node to focus'}</span>
    </label>
  );
}

function OutputPreviewBlock({ output }: { output: JsonRecord }) {
  const data = isRecord(output.data) ? output.data : null;
  const dataPreview = isRecord(data?.data_preview) ? data.data_preview : null;
  const summary = isRecord(output.evaluation_summary) ? output.evaluation_summary : null;
  if (dataPreview) {
    return <DataPreviewTable preview={dataPreview} />;
  }
  if (summary) {
    return <SummaryTable summary={summary} />;
  }
  return null;
}

function DataPreviewTable({ preview }: { preview: JsonRecord }) {
  const columns = Array.isArray(preview.columns) ? preview.columns.map(String) : [];
  const rows = Array.isArray(preview.rows) ? preview.rows.filter(isRecord) : [];
  return (
    <div className="preview-table-wrap" style={{ marginTop: 8 }}>
      <table className="preview-table">
        <thead>
          <tr>
            <th>#</th>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row.index ?? rowIndex)}>
              <td>{String(row.index ?? rowIndex)}</td>
              {(Array.isArray(row.values) ? row.values : []).map((value, valueIndex) => (
                <td key={valueIndex}>{formatValue(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="preview-caption">
        {rows.length} / {String(preview.row_count ?? rows.length)} rows
      </div>
    </div>
  );
}

function SummaryTable({ summary }: { summary: JsonRecord }) {
  const rows = Array.isArray(summary.rows) ? summary.rows.filter(isRecord) : [];
  const primaryMetric = typeof summary.primary_metric === 'string' ? summary.primary_metric : 'f1';
  return (
    <div className="preview-table-wrap" style={{ marginTop: 8 }}>
      <table className="preview-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Node</th>
            <th>{primaryMetric}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.source_node_id ?? row.label ?? index)}>
              <td>{String(row.rank ?? index + 1)}</td>
              <td>{String(row.label ?? row.source_node_id ?? 'evaluation')}</td>
              <td>{formatValue(row[primaryMetric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : String(value ?? '-');
}

export function RunPanel({
  events,
  runStatus,
  nodeOutputs,
  selectedNodeId,
  manifest,
  artifacts: apiArtifacts = [],
  onOpenArtifact,
}: RunPanelProps) {
  const [activeTab, setActiveTab] = useState<RunPanelTab>('logs');
  const [logFilter, setLogFilter] = useState('');
  const [outputFilter, setOutputFilter] = useState('');
  const [artifactFilter, setArtifactFilter] = useState('');
  const [focusSelected, setFocusSelected] = useState(true);

  const allEvents = useMemo(() => {
    const merged = manifest?.events?.length ? manifest.events : events;
    return [...(merged ?? [])].sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  }, [events, manifest?.events]);

  const outputs = useMemo(() => collectOutputs(nodeOutputs, manifest), [manifest, nodeOutputs]);
  const artifacts = useMemo(() => collectArtifacts(outputs, apiArtifacts), [apiArtifacts, outputs]);
  const focusedNode = focusSelected ? selectedNodeId : null;

  const visibleEvents = allEvents.filter((event) => {
    if (focusedNode && eventNodeId(event) !== focusedNode) return false;
    return matchesFilter(`${eventName(event)} ${eventMessage(event)} ${safeText(event.payload)}`, logFilter);
  });
  const visibleOutputs = outputs.filter((entry) => {
    if (focusedNode && entry.nodeId !== focusedNode) return false;
    return matchesFilter(`${entry.nodeId} ${entry.status ?? ''} ${entry.nodeType ?? ''} ${safeText(entry.output)}`, outputFilter);
  });
  const visibleArtifacts = artifacts.filter((artifact) => {
    if (focusedNode && artifact.nodeId !== focusedNode) return false;
    return matchesFilter(`${artifact.nodeId} ${artifact.label} ${artifact.kind ?? ''} ${artifact.path ?? ''} ${artifact.source}`, artifactFilter);
  });
  const selectedOutput = selectedNodeId ? outputs.find((entry) => entry.nodeId === selectedNodeId)?.output : undefined;
  const selectedMetrics = metricRows(selectedOutput);
  const activeFilter = activeTab === 'logs' ? logFilter : activeTab === 'outputs' ? outputFilter : artifactFilter;
  const activeFilterSetter = activeTab === 'logs' ? setLogFilter : activeTab === 'outputs' ? setOutputFilter : setArtifactFilter;

  return (
    <footer className="run-panel">
      <section style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 }}>
        <div className="panel-heading small">
          {activeIcon(runStatus)}
          <span>Run</span>
          <strong>{runStatus}</strong>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <TabButton key={tab.id} active={activeTab === tab.id} label={tab.label} onClick={() => setActiveTab(tab.id)} />
          ))}
        </div>
        <FilterBox label={`${tabs.find((tab) => tab.id === activeTab)?.label ?? 'Items'} filter`} value={activeFilter} onChange={activeFilterSetter} />
        <FocusToggle selectedNodeId={selectedNodeId} checked={focusSelected} onChange={setFocusSelected} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <div className="metric">
            <span>Logs</span>
            <strong>{visibleEvents.length}</strong>
          </div>
          <div className="metric">
            <span>Outputs</span>
            <strong>{visibleOutputs.length}</strong>
          </div>
          <div className="metric">
            <span>Artifacts</span>
            <strong>{visibleArtifacts.length}</strong>
          </div>
        </div>
      </section>

      <section style={{ minWidth: 0 }}>
        <div className="panel-heading small">
          {activeTab === 'logs' ? <ScrollText size={15} /> : activeTab === 'outputs' ? <CheckCircle2 size={15} /> : <Files size={15} />}
          <span>{tabs.find((tab) => tab.id === activeTab)?.label}</span>
          <strong>{focusedNode ?? 'all nodes'}</strong>
        </div>

        {activeTab === 'logs' ? (
          <div className="event-log">
            {visibleEvents.slice(-30).map((event, index) => (
              <div key={`${event.index ?? index}-${eventName(event)}`} className={`event event-${eventName(event)}`}>
                <span>{eventName(event)}</span>
                <code>{eventMessage(event)}</code>
              </div>
            ))}
            {!visibleEvents.length ? <div className="empty-state compact">No matching run events.</div> : null}
          </div>
        ) : null}

        {activeTab === 'outputs' ? (
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            {selectedMetrics.length && focusedNode === selectedNodeId ? (
              <div className="metrics-grid">
                {selectedMetrics.map(([key, value]) => (
                  <div key={key} className="metric">
                    <span>{key}</span>
                    <strong>{Number(value).toFixed(4)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="event-log">
              {visibleOutputs.map((entry) => (
                <details key={entry.nodeId} className="event" open={entry.nodeId === selectedNodeId}>
                  <summary>
                    <span>{entry.nodeId}</span>
                    <code>{entry.status ?? outputKind(entry.output)}</code>
                  </summary>
                  <OutputPreviewBlock output={entry.output} />
                  <pre className="output-json" style={{ height: 132, marginTop: 8 }}>
                    {jsonPreview(entry.output)}
                  </pre>
                </details>
              ))}
              {!visibleOutputs.length ? <div className="empty-state compact">No matching node outputs.</div> : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'artifacts' ? (
          <div className="event-log">
            {visibleArtifacts.map((artifact) => (
              <div key={artifact.id} className="event">
                <span>{artifact.nodeId}</span>
                <code title={artifact.path ?? artifact.source}>{artifact.path ?? artifact.source}</code>
                {onOpenArtifact ? (
                  <button type="button" onClick={() => onOpenArtifact(artifact)} style={{ gridColumn: '1 / -1', minHeight: 28 }}>
                    <Filter size={13} />
                    Open Artifact
                  </button>
                ) : null}
              </div>
            ))}
            {!visibleArtifacts.length ? <div className="empty-state compact">No matching artifact references.</div> : null}
          </div>
        ) : null}
      </section>
    </footer>
  );
}
