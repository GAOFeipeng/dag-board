import { Box, Database, GitBranch, LineChart, PlayCircle, Table2, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeTypeDefinition } from '../types';

const iconByType = {
  structure_generator: GitBranch,
  data_generator: Database,
  algorithm: PlayCircle,
  evaluation: LineChart,
  evaluation_summary: Table2,
  graph_view: Workflow,
};

export function NodePalette({ nodeTypes }: { nodeTypes: NodeTypeDefinition[] }) {
  const { t } = useTranslation();
  return (
    <aside className="left-panel">
      <div className="panel-heading">
        <Box size={16} />
        <span>{t('panels.nodes')}</span>
      </div>
      <div className="node-palette">
        {nodeTypes.map((item) => {
          const Icon = iconByType[item.id as keyof typeof iconByType] ?? Box;
          return (
            <button
              key={item.id}
              className="palette-item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/dagboard-node', item.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              title={item.description}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
