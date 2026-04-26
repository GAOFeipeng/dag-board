import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type JsonRecord = Record<string, unknown>;

type GraphView = {
  nodes?: Array<{ id: string; label: string; index: number }>;
  edges?: Array<{ source: string; target: string; status?: string; weight?: number }>;
  render_meta?: { edge_count?: number; source?: string; compare_mode?: string };
};

type DataPreview = {
  columns?: string[];
  row_count?: number;
  preview_count?: number;
  rows?: Array<{ index?: number; values?: unknown[] }>;
};

export function GraphPreview({
  graphView,
  selectedNodeId,
  selectedOutput,
}: {
  graphView: Record<string, unknown> | null;
  selectedNodeId?: string | null;
  selectedOutput?: Record<string, unknown> | null;
}) {
  const { t } = useTranslation();
  const output = selectedOutput ?? null;
  const dataOutput = isRecord(output?.data) ? output.data : null;
  const dataPreview = isRecord(dataOutput?.data_preview) ? (dataOutput.data_preview as DataPreview) : null;
  const summary = isRecord(output?.evaluation_summary) ? output.evaluation_summary : null;
  const evaluation = isRecord(output?.evaluation) ? output.evaluation : null;
  const view = graphViewFromOutput(output) ?? ((graphView ?? {}) as GraphView);
  const nodes = view.nodes ?? [];
  const edges = view.edges ?? [];
  const headingDetail = selectedNodeId ?? view.render_meta?.source ?? t('panels.none');

  return (
    <section className="graph-preview">
      <div className="panel-heading small">
        <Network size={15} />
        <span>{t('panels.outputPreview')}</span>
        <strong>{headingDetail}</strong>
      </div>
      {dataPreview ? <DataPreviewTable preview={dataPreview} /> : null}
      {!dataPreview && summary ? <SummaryPreview summary={summary} /> : null}
      {!dataPreview && !summary && evaluation ? <MetricsPreview evaluation={evaluation} /> : null}
      {!dataPreview && !summary && !evaluation && nodes.length ? <GraphSvg view={view} /> : null}
      {!dataPreview && !summary && !evaluation && !nodes.length ? (
        <div className="empty-state compact">{selectedNodeId ? t('panels.noPreview') : t('panels.selectOutputNode')}</div>
      ) : null}
    </section>
  );
}

function GraphSvg({ view }: { view: GraphView }) {
  const nodes = view.nodes ?? [];
  const edges = view.edges ?? [];
  const width = 340;
  const height = 230;
  const radius = Math.min(88, Math.max(46, nodes.length * 9));
  const positions = new Map(
    nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return [node.id, { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius }];
    }),
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      {edges.slice(0, 220).map((edge, index) => {
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
            className={`preview-edge edge-${edge.status ?? 'plain'}`}
          />
        );
      })}
      {nodes.map((node) => {
        const position = positions.get(node.id)!;
        return (
          <g key={node.id}>
            <circle cx={position.x} cy={position.y} r="8" />
            <text x={position.x} y={position.y - 12}>
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DataPreviewTable({ preview }: { preview: DataPreview }) {
  const columns = preview.columns ?? [];
  const rows = preview.rows ?? [];
  return (
    <div className="preview-table-wrap">
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
            <tr key={row.index ?? rowIndex}>
              <td>{row.index ?? rowIndex}</td>
              {(row.values ?? []).map((value, valueIndex) => (
                <td key={`${row.index ?? rowIndex}-${valueIndex}`}>{formatNumber(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="preview-caption">
        {rows.length} / {preview.row_count ?? rows.length} rows
      </div>
    </div>
  );
}

function SummaryPreview({ summary }: { summary: JsonRecord }) {
  const rows = Array.isArray(summary.rows) ? summary.rows.filter(isRecord) : [];
  const primaryMetric = typeof summary.primary_metric === 'string' ? summary.primary_metric : 'f1';
  const direction = typeof summary.effective_sort_order === 'string' ? summary.effective_sort_order : summary.sort_order;
  return (
    <div className="preview-table-wrap">
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
              <td>{formatNumber(row[primaryMetric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="preview-caption">{direction === 'asc' ? 'lower is better' : 'higher is better'}</div>
    </div>
  );
}

function MetricsPreview({ evaluation }: { evaluation: JsonRecord }) {
  const metrics = isRecord(evaluation.metrics) ? evaluation.metrics : {};
  return (
    <div className="preview-metrics">
      {Object.entries(metrics)
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        .map(([key, value]) => (
          <div key={key} className="metric">
            <span>{key}</span>
            <strong>{formatNumber(value)}</strong>
          </div>
        ))}
    </div>
  );
}

function graphViewFromOutput(output: Record<string, unknown> | null): GraphView | null {
  if (!output) return null;
  if (isRecord(output.graph_view)) return output.graph_view as GraphView;
  if (isRecord(output.graph)) return output.graph as GraphView;
  if (isRecord(output.algorithm_result) && isRecord(output.algorithm_result.result_graph)) {
    return output.algorithm_result.result_graph as GraphView;
  }
  return null;
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : String(value ?? '-');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
