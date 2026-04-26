import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, CheckCircle2, Clock3, Database, EyeOff, GitBranch, LineChart, PlayCircle, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeField, NodePort, StudioNodeData } from '../types';

const iconByType = {
  structure_generator: GitBranch,
  data_generator: Database,
  algorithm: PlayCircle,
  evaluation: LineChart,
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
            {inputPorts.map((port, index) => (
              <PortRow key={port.id} port={port} index={index} count={inputPorts.length} type="target" />
            ))}
          </div>
          <div className="node-port-column outputs">
            {outputPorts.map((port, index) => (
              <PortRow key={port.id} port={port} index={index} count={outputPorts.length} type="source" />
            ))}
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
  index,
  count,
  type,
}: {
  port: NodePort;
  index: number;
  count: number;
  type: 'target' | 'source';
}) {
  const position = type === 'target' ? Position.Left : Position.Right;
  const top = `${84 + index * 18}px`;
  return (
    <div className={`node-port-row ${type}`}>
      <Handle id={port.id} type={type} position={position} className="node-handle" style={{ top }} />
      <span title={`${port.label} (${port.kind})`}>
        {port.label}
        {port.required === false ? '' : '*'}
      </span>
      {count > 1 ? <small>{port.kind}</small> : null}
    </div>
  );
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
          value={typeof current === 'number' ? current : Number(current ?? 0)}
          onChange={(event) => {
            const parsed = field.kind === 'integer' ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value);
            update(Number.isFinite(parsed) ? parsed : field.default);
          }}
        />
      ) : (
        <input value={String(current ?? '')} onChange={(event) => update(event.target.value)} />
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
