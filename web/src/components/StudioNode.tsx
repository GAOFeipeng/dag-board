import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, CheckCircle2, Clock3, Database, EyeOff, GitBranch, GitMerge, LineChart, PlayCircle, Table2, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeField, NodePort, StudioNodeData } from '../types';

const iconByType = {
  structure_generator: GitBranch,
  data_generator: Database,
  data_combiner: GitMerge,
  algorithm: PlayCircle,
  evaluation: LineChart,
  evaluation_summary: Table2,
  graph_view: Workflow,
};

export function StudioNode({ id, data, selected }: NodeProps) {
  const { t } = useTranslation();
  const nodeData = data as StudioNodeData;
  const Icon = iconByType[nodeData.nodeType as keyof typeof iconByType] ?? Workflow;
  const status = nodeData.status ?? 'idle';
  const StatusIcon = status === 'success' ? CheckCircle2 : status === 'failed' ? AlertCircle : status === 'running' ? Clock3 : null;
  const inputPorts = nodeData.inputPorts ?? [];
  const outputPorts = nodeData.outputPorts ?? [];
  const inputStatus = nodeData.inputStatus ?? { required: 0, satisfied: 0, missing: [] };

  return (
    <div className={`studio-node status-${status} ${nodeData.disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`}>
      <div className="node-title">
        <Icon size={16} />
        <span>{nodeData.label}</span>
        {StatusIcon ? <StatusIcon size={15} className="status-icon" /> : null}
      </div>
      <div className="node-subtitle">
        {t(`catalog.nodeTypes.${nodeData.nodeType}.label`, { defaultValue: nodeData.nodeType.replaceAll('_', ' ') })}
      </div>
      <div className={`node-input-status ${inputStatus.missing.length ? 'missing' : ''}`}>
        <span>{inputStatus.satisfied}/{inputStatus.required} {t('node.required')}</span>
        {inputStatus.missing.length ? <strong>{t('node.missing')}: {inputStatus.missing.join(', ')}</strong> : null}
      </div>
      {inputPorts.length || outputPorts.length ? (
        <div className="node-ports">
          <div className="node-port-column inputs">
            <div className="node-port-column-title">{t('node.inputs')}</div>
            {inputPorts.length ? (
              inputPorts.map((port) => <PortRow key={port.id} port={port} type="target" />)
            ) : (
              <div className="node-port-empty">{t('node.noInputs')}</div>
            )}
          </div>
          <div className="node-port-column outputs">
            <div className="node-port-column-title">{t('node.outputs')}</div>
            {outputPorts.length ? (
              outputPorts.map((port) => <PortRow key={port.id} port={port} type="source" />)
            ) : (
              <div className="node-port-empty">{t('node.noOutputs')}</div>
            )}
          </div>
        </div>
      ) : null}
      {nodeData.inlineFields?.length ? (
        <div className="inline-fields nodrag nopan nowheel">
          {nodeData.inlineFields.map((field) => (
            <InlineField
              key={field.name}
              field={field}
              value={nodeData.params?.[field.name]}
              onChange={(value) => nodeData.onInlineParamChange?.(id, field.name, value)}
              nodeId={id}
            />
          ))}
        </div>
      ) : null}
      {nodeData.showPreview ? (
        <InlinePreview
          nodeId={id}
          output={nodeData.previewOutput}
          onHide={() => {
            nodeData.onTogglePreview?.(id);
          }}
        />
      ) : null}
    </div>
  );
}

function PortRow({
  port,
  type,
}: {
  port: NodePort;
  type: 'target' | 'source';
}) {
  const position = type === 'target' ? Position.Left : Position.Right;
  const kindClass = portKindClass(port.kind);
  return (
    <div className={`node-port-row ${type} ${kindClass}`} title={`${port.label} (${port.kind})`}>
      <Handle
        id={port.id}
        type={type}
        position={position}
        className={`node-handle ${type} ${kindClass}`}
        aria-label={`${type === 'target' ? 'input' : 'output'} ${port.label} ${port.kind}`}
      />
      <span>
        <strong>{port.label}</strong>
        {port.required === false ? null : <em>{port.min_count && port.min_count > 1 ? `x${port.min_count}` : '*'}</em>}
      </span>
      <small>{port.kind}</small>
    </div>
  );
}

function portKindClass(kind: string): string {
  return `port-kind-${kind.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
}

function InlineField({
  field,
  value,
  nodeId,
  onChange,
}: {
  field: NodeField;
  value: unknown;
  nodeId: string;
  onChange: (value: unknown) => void;
}) {
  const current = value ?? field.default;
  const update = (nextValue: unknown) => {
    if (nodeId) onChange(nextValue);
  };
  return (
    <label className="inline-field" onPointerDown={(event) => event.stopPropagation()}>
      <span>{field.label}</span>
      {field.kind === 'select' && field.options.length ? (
        <select value={String(current ?? '')} onChange={(event) => update(event.target.value)}>
          {field.default === null || field.default === undefined ? <option value="">{field.placeholder || 'official default'}</option> : null}
          {field.options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : field.kind === 'boolean' ? (
        <input type="checkbox" checked={Boolean(current)} onChange={(event) => update(event.target.checked)} />
      ) : field.kind === 'integer' || field.kind === 'number' ? (
        <input
          type="number"
          step={field.kind === 'integer' ? 1 : 0.01}
          value={current === null || current === undefined || current === '' ? '' : Number(current)}
          placeholder={field.placeholder}
          onChange={(event) => {
            if (event.target.value === '') {
              update(null);
              return;
            }
            const parsed = field.kind === 'integer' ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value);
            update(Number.isFinite(parsed) ? parsed : null);
          }}
        />
      ) : (
        <input value={String(current ?? '')} placeholder={field.placeholder} onChange={(event) => update(event.target.value)} />
      )}
    </label>
  );
}

function InlinePreview({
  nodeId,
  output,
  onHide,
}: {
  nodeId: string;
  output: Record<string, unknown> | null | undefined;
  onHide: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-preview nodrag nopan nowheel">
      <div className="inline-preview-head">
        <span>{t('node.preview')}</span>
        <button type="button" title={t('contextMenu.hidePreview')} onClick={onHide}>
          <EyeOff size={12} />
        </button>
      </div>
      {output ? renderPreview(output, nodeId) : <div className="inline-preview-empty">{t('nodePreview.waiting')}</div>}
    </div>
  );
}

function renderPreview(output: Record<string, unknown>, nodeId: string) {
  const metrics = isRecord(output.metrics) ? output.metrics : null;
  if (metrics) {
    return (
      <div className="inline-metrics">
        {Object.entries(metrics)
          .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
          .slice(0, 6)
          .map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{Number(value).toFixed(3)}</strong>
            </div>
          ))}
      </div>
    );
  }

  const rows = Array.isArray(output.rows) ? output.rows.filter(isRecord) : [];
  const primaryMetric = typeof output.primary_metric === 'string' ? output.primary_metric : 'f1';
  if (rows.length) {
    return (
      <div className="inline-summary-table">
        {rows.slice(0, 5).map((row) => {
          const label = String(row.label ?? row.source_node_id ?? 'evaluation');
          const value = typeof row[primaryMetric] === 'number' ? Number(row[primaryMetric]).toFixed(3) : '-';
          return (
            <div key={String(row.source_node_id ?? label)}>
              <span>{row.rank ? `#${row.rank} ${label}` : label}</span>
              <strong>{primaryMetric}: {value}</strong>
            </div>
          );
        })}
      </div>
    );
  }

  const dataPreview = isRecord(output.data_preview) ? output.data_preview : null;
  if (dataPreview) {
    return <InlineDataTable preview={dataPreview} />;
  }

  const nodes = getPreviewNodes(output);
  const edges = getPreviewEdges(output);
  if (nodes.length) {
    return <MiniGraph nodeId={nodeId} nodes={nodes} edges={edges} />;
  }

  const matrixSummary = isRecord(output.matrix_summary) ? output.matrix_summary : null;
  if (matrixSummary) {
    return (
      <div className="inline-metrics">
        {Object.entries(matrixSummary)
          .slice(0, 4)
          .map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{isRecord(value) && Array.isArray(value.shape) ? value.shape.join('x') : 'matrix'}</strong>
            </div>
          ))}
      </div>
    );
  }

  return <pre className="inline-json">{JSON.stringify(output, null, 2)}</pre>;
}

function InlineDataTable({ preview }: { preview: Record<string, unknown> }) {
  const columns = Array.isArray(preview.columns) ? preview.columns.map(String).slice(0, 5) : [];
  const rows = Array.isArray(preview.rows) ? preview.rows.filter(isRecord).slice(0, 5) : [];
  return (
    <div className="inline-data-table">
      <div className="inline-data-head">
        <span>#</span>
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {rows.map((row, rowIndex) => {
        const values = Array.isArray(row.values) ? row.values.slice(0, columns.length) : [];
        return (
          <div key={String(row.index ?? rowIndex)} className="inline-data-row">
            <span>{String(row.index ?? rowIndex)}</span>
            {values.map((value, valueIndex) => (
              <span key={valueIndex}>{typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : String(value ?? '-')}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MiniGraph({
  nodeId,
  nodes,
  edges,
}: {
  nodeId: string;
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ source: string; target: string; status?: string }>;
}) {
  const width = 210;
  const height = 120;
  const radius = Math.min(45, Math.max(25, nodes.length * 5.2));
  const positions = new Map(
    nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius }];
    }),
  );
  return (
    <svg className="inline-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${nodeId} preview`}>
      {edges.slice(0, 80).map((edge, index) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) return null;
        return (
          <line
            key={`${edge.source}-${edge.target}-${index}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            className={`inline-edge edge-${edge.status ?? 'plain'}`}
          />
        );
      })}
      {nodes.map((node) => {
        const position = positions.get(node.id)!;
        return (
          <g key={node.id}>
            <circle cx={position.x} cy={position.y} r="5" />
            <text x={position.x} y={position.y - 8}>
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function getPreviewNodes(output: Record<string, unknown>): Array<{ id: string; label: string }> {
  const rawNodes = Array.isArray(output.nodes) ? output.nodes : [];
  return rawNodes
    .filter(isRecord)
    .map((node, index) => ({
      id: String(node.id ?? node.label ?? index),
      label: String(node.label ?? node.id ?? index),
    }));
}

function getPreviewEdges(output: Record<string, unknown>): Array<{ source: string; target: string; status?: string }> {
  const rawEdges = Array.isArray(output.edges) ? output.edges : Array.isArray(output.edge_list) ? output.edge_list : [];
  return rawEdges
    .filter(isRecord)
    .map((edge) => ({
      source: String(edge.source),
      target: String(edge.target),
      status: typeof edge.status === 'string' ? edge.status : undefined,
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
