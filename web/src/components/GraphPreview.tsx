import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type GraphView = {
  nodes?: Array<{ id: string; label: string; index: number }>;
  edges?: Array<{ source: string; target: string; status?: string; weight?: number }>;
  render_meta?: { edge_count?: number; source?: string; compare_mode?: string };
};

export function GraphPreview({ graphView }: { graphView: Record<string, unknown> | null }) {
  const { t } = useTranslation();
  const view = (graphView ?? {}) as GraphView;
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
    <section className="graph-preview">
      <div className="panel-heading small">
        <Network size={15} />
        <span>{t('panels.graphPreview')}</span>
        <strong>{view.render_meta?.source ?? t('panels.none')}</strong>
      </div>
      {nodes.length ? (
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
      ) : (
        <div className="empty-state compact">{t('panels.graphEmpty')}</div>
      )}
    </section>
  );
}
