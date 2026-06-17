import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { NodeTypeDefinition, StudioEdge, StudioNode, WorkflowPayload } from './types';

export const WORKFLOW_TEMPLATE_IDS = ['baseline_compare', 'residual_data_loop', 'algorithm_sweep'] as const;

export type WorkflowTemplateId = (typeof WORKFLOW_TEMPLATE_IDS)[number];

type WorkflowTemplateOptions = {
  idPrefix?: string;
  origin?: { x: number; y: number };
  selected?: boolean;
};

export function defaultParams(definition: NodeTypeDefinition): Record<string, unknown> {
  return Object.fromEntries(definition.fields.map((field) => [field.name, field.default]));
}

export function wouldCreateCycle(nodes: Pick<Node, 'id'>[], edges: Pick<Edge, 'source' | 'target'>[], source: string, target: string): boolean {
  if (source === target) {
    return true;
  }
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  adjacency.get(source)?.push(target);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }
  return false;
}

export function toWorkflowPayload(nodes: StudioNode[], edges: Edge[], name = 'DAGBoard workflow'): WorkflowPayload {
  return {
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      position: node.position,
      data: {
        label: node.data.label,
        params: node.data.params,
        disabled: node.data.disabled,
        previewCollapsed: node.data.previewCollapsed,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
    metadata: { client: 'dagboard-web' },
  };
}

export function createDefaultWorkflow(): { nodes: StudioNode[]; edges: Edge[] } {
  const nodes: StudioNode[] = [
    {
      id: 'structure',
      type: 'studio',
      position: { x: 40, y: 210 },
      data: { label: 'Structure', nodeType: 'structure_generator', params: { d: 6, s0: 7, graph_type: 'ER', seed: 42 } },
    },
    {
      id: 'data',
      type: 'studio',
      position: { x: 320, y: 210 },
      data: { label: 'Data', nodeType: 'data_generator', params: { n_samples: 100, sem_type: 'gauss', sem_noise: 1, seed: 42, standardize: true } },
    },
    {
      id: 'pc',
      type: 'studio',
      position: { x: 600, y: 20 },
      data: { label: 'PC Baseline', nodeType: 'algorithm', params: { algorithm_id: 'PC' } },
    },
    {
      id: 'ges',
      type: 'studio',
      position: { x: 600, y: 240 },
      data: { label: 'GES Baseline', nodeType: 'algorithm', params: { algorithm_id: 'GES' } },
    },
    {
      id: 'notears',
      type: 'studio',
      position: { x: 600, y: 460 },
      data: { label: 'NOTEARS Baseline', nodeType: 'algorithm', params: { algorithm_id: 'Notears' } },
    },
    {
      id: 'eval-pc',
      type: 'studio',
      position: { x: 900, y: 20 },
      data: { label: 'Evaluate PC', nodeType: 'evaluation', params: { mode: 'compare', threshold: 0.3, graph_space: 'dag' } },
    },
    {
      id: 'eval-ges',
      type: 'studio',
      position: { x: 900, y: 240 },
      data: { label: 'Evaluate GES', nodeType: 'evaluation', params: { mode: 'compare', threshold: 0.3, graph_space: 'dag' } },
    },
    {
      id: 'eval-notears',
      type: 'studio',
      position: { x: 900, y: 460 },
      data: { label: 'Evaluate NOTEARS', nodeType: 'evaluation', params: { mode: 'compare', threshold: 0.3, graph_space: 'dag' } },
    },
    {
      id: 'view-pc',
      type: 'studio',
      position: { x: 1200, y: 20 },
      data: { label: 'PC Graph View', nodeType: 'graph_view', params: { compare_mode: 'overlay', threshold: 0.3, top_k: 200 } },
    },
    {
      id: 'view-ges',
      type: 'studio',
      position: { x: 1200, y: 240 },
      data: { label: 'GES Graph View', nodeType: 'graph_view', params: { compare_mode: 'overlay', threshold: 0.3, top_k: 200 } },
    },
    {
      id: 'view-notears',
      type: 'studio',
      position: { x: 1200, y: 460 },
      data: { label: 'NOTEARS Graph View', nodeType: 'graph_view', params: { compare_mode: 'overlay', threshold: 0.3, top_k: 200 } },
    },
    {
      id: 'summary',
      type: 'studio',
      position: { x: 1500, y: 240 },
      data: { label: 'Evaluation Summary', nodeType: 'evaluation_summary', params: { primary_metric: 'f1', sort_order: 'auto', metrics: [] } },
    },
  ];
  const edges: Edge[] = [
    defaultEdge('structure-data', 'structure', 'data', 'graph', 'graph'),
    defaultEdge('data-pc', 'data', 'pc', 'data', 'data'),
    defaultEdge('data-ges', 'data', 'ges', 'data', 'data'),
    defaultEdge('data-notears', 'data', 'notears', 'data', 'data'),
    defaultEdge('data-graph-eval-pc', 'data', 'eval-pc', 'graph', 'graph'),
    defaultEdge('data-graph-eval-ges', 'data', 'eval-ges', 'graph', 'graph'),
    defaultEdge('data-graph-eval-notears', 'data', 'eval-notears', 'graph', 'graph'),
    defaultEdge('pc-graph-eval-pc', 'pc', 'eval-pc', 'graph', 'graph'),
    defaultEdge('ges-graph-eval-ges', 'ges', 'eval-ges', 'graph', 'graph'),
    defaultEdge('notears-graph-eval-notears', 'notears', 'eval-notears', 'graph', 'graph'),
    defaultEdge('data-view-pc', 'data', 'view-pc', 'data', 'data'),
    defaultEdge('data-view-ges', 'data', 'view-ges', 'data', 'data'),
    defaultEdge('data-view-notears', 'data', 'view-notears', 'data', 'data'),
    defaultEdge('pc-view-pc', 'pc', 'view-pc', 'graph', 'graph'),
    defaultEdge('ges-view-ges', 'ges', 'view-ges', 'graph', 'graph'),
    defaultEdge('notears-view-notears', 'notears', 'view-notears', 'graph', 'graph'),
    defaultEdge('eval-pc-view-pc', 'eval-pc', 'view-pc', 'evaluation', 'evaluation'),
    defaultEdge('eval-ges-view-ges', 'eval-ges', 'view-ges', 'evaluation', 'evaluation'),
    defaultEdge('eval-notears-view-notears', 'eval-notears', 'view-notears', 'evaluation', 'evaluation'),
    defaultEdge('eval-pc-summary', 'eval-pc', 'summary', 'evaluation', 'evaluation'),
    defaultEdge('eval-ges-summary', 'eval-ges', 'summary', 'evaluation', 'evaluation'),
    defaultEdge('eval-notears-summary', 'eval-notears', 'summary', 'evaluation', 'evaluation'),
  ];
  return { nodes, edges };
}

export function createWorkflowTemplate(
  templateId: WorkflowTemplateId,
  options: WorkflowTemplateOptions = {},
): { nodes: StudioNode[]; edges: Edge[] } {
  const template =
    templateId === 'residual_data_loop'
      ? createResidualDataLoopWorkflow()
      : templateId === 'algorithm_sweep'
        ? createAlgorithmSweepWorkflow()
        : createDefaultWorkflow();
  return materializeTemplate(template, options);
}

function createAlgorithmSweepWorkflow(): { nodes: StudioNode[]; edges: Edge[] } {
  const nodes: StudioNode[] = [
    templateNode('structure', 'Structure', 'structure_generator', { x: 40, y: 230 }, { d: 8, s0: 12, graph_type: 'ER', seed: 42 }),
    templateNode('data', 'Data', 'data_generator', { x: 340, y: 230 }, { n_samples: 200, sem_type: 'gauss', sem_noise: 1, seed: 42, standardize: true }),
    templateNode(
      'sweep',
      'Algorithm Sweep',
      'experiment_sweep',
      { x: 660, y: 120 },
      {
        algorithms: ['PC', 'GES', 'DAGMA'],
        param_grid: {
          PC: { alpha: [0.01, 0.05] },
          GES: { criterion: ['bic'] },
          DAGMA: { lambda1: [0.02, 0.04] },
        },
        seeds: [null],
        metrics: ['shd', 'f1', 'precision', 'recall', 'aupr', 'dag_error', 'is_acyclic'],
        threshold: 0.3,
        timeout_sec: null,
      },
    ),
    templateNode('truth-view', 'Truth Graph View', 'graph_view', { x: 660, y: 430 }, { compare_mode: 'single', threshold: 0.3, top_k: 200 }),
    templateNode('report', 'Sweep Report', 'report_export', { x: 980, y: 190 }, { title: 'Algorithm Sweep Report' }),
  ];
  const edges: Edge[] = [
    defaultEdge('structure-data', 'structure', 'data', 'graph', 'graph'),
    defaultEdge('data-sweep', 'data', 'sweep', 'data', 'data'),
    defaultEdge('structure-sweep', 'structure', 'sweep', 'graph', 'graph'),
    defaultEdge('structure-truth-view', 'structure', 'truth-view', 'graph', 'graph'),
    defaultEdge('data-truth-view', 'data', 'truth-view', 'data', 'data'),
    defaultEdge('data-report', 'data', 'report', 'data', 'data'),
    defaultEdge('structure-report', 'structure', 'report', 'graph', 'graph'),
    defaultEdge('sweep-report', 'sweep', 'report', 'evaluation_summary', 'evaluation_summary'),
    defaultEdge('truth-view-report', 'truth-view', 'report', 'graph_view', 'graph_view'),
  ];
  return { nodes, edges };
}

function createResidualDataLoopWorkflow(): { nodes: StudioNode[]; edges: Edge[] } {
  const nodes: StudioNode[] = [
    templateNode('structure', 'Structure', 'structure_generator', { x: 40, y: 290 }, { d: 10, s0: 16, graph_type: 'ER', seed: 42 }),
    templateNode('base-data', 'Base Data', 'data_generator', { x: 330, y: 190 }, { n_samples: 120, sem_type: 'gauss', sem_noise: 1, seed: 42, standardize: true }),
    templateNode('seed-algo', 'Seed Graph PC', 'algorithm', { x: 630, y: 190 }, { algorithm_id: 'PC' }),
    templateNode('seed-eval', 'Evaluate Seed', 'evaluation', { x: 930, y: 40 }, { mode: 'compare', threshold: 0.3, graph_space: 'dag' }),
    templateNode('graph-adapter', 'Graph Adapter', 'graph_editor', { x: 930, y: 340 }, { edits: [] }),
    templateNode('residual-data', 'Residual Data', 'data_generator', { x: 1230, y: 340 }, { n_samples: 120, sem_type: 'gauss', sem_noise: 1, seed: 84, standardize: true }),
    templateNode('data-combiner', 'Base + Residual Data', 'data_combiner', { x: 1530, y: 260 }, { shuffle: false, standardize: true, seed: null }),
    templateNode('combined-algo', 'Combined Graph GES', 'algorithm', { x: 1830, y: 260 }, { algorithm_id: 'GES' }),
    templateNode('combined-eval', 'Evaluate Combined', 'evaluation', { x: 2130, y: 260 }, { mode: 'compare', threshold: 0.3, graph_space: 'dag' }),
    templateNode('summary', 'Residual Summary', 'evaluation_summary', { x: 2430, y: 150 }, { primary_metric: 'f1', sort_order: 'auto', metrics: [] }),
    templateNode('combined-view', 'Combined Graph View', 'graph_view', { x: 2430, y: 410 }, { compare_mode: 'overlay', threshold: 0.3, top_k: 200 }),
  ];
  const edges: Edge[] = [
    defaultEdge('structure-base-data', 'structure', 'base-data', 'graph', 'graph'),
    defaultEdge('base-data-seed-algo', 'base-data', 'seed-algo', 'data', 'data'),
    defaultEdge('base-data-seed-eval', 'base-data', 'seed-eval', 'graph', 'graph'),
    defaultEdge('seed-algo-seed-eval', 'seed-algo', 'seed-eval', 'graph', 'graph'),
    defaultEdge('seed-algo-graph-adapter', 'seed-algo', 'graph-adapter', 'graph', 'graph'),
    defaultEdge('graph-adapter-residual-data', 'graph-adapter', 'residual-data', 'graph', 'graph'),
    defaultEdge('base-data-data-combiner', 'base-data', 'data-combiner', 'data', 'data'),
    defaultEdge('residual-data-data-combiner', 'residual-data', 'data-combiner', 'data', 'data'),
    defaultEdge('data-combiner-combined-algo', 'data-combiner', 'combined-algo', 'data', 'data'),
    defaultEdge('base-data-combined-eval', 'base-data', 'combined-eval', 'graph', 'graph'),
    defaultEdge('combined-algo-combined-eval', 'combined-algo', 'combined-eval', 'graph', 'graph'),
    defaultEdge('seed-eval-summary', 'seed-eval', 'summary', 'evaluation', 'evaluation'),
    defaultEdge('combined-eval-summary', 'combined-eval', 'summary', 'evaluation', 'evaluation'),
    defaultEdge('base-data-combined-view', 'base-data', 'combined-view', 'data', 'data'),
    defaultEdge('combined-algo-combined-view', 'combined-algo', 'combined-view', 'graph', 'graph'),
    defaultEdge('combined-eval-combined-view', 'combined-eval', 'combined-view', 'evaluation', 'evaluation'),
  ];
  return { nodes, edges };
}

function templateNode(
  id: string,
  label: string,
  nodeType: string,
  position: { x: number; y: number },
  params: Record<string, unknown>,
): StudioNode {
  return {
    id,
    type: 'studio',
    position,
    data: {
      label,
      nodeType,
      params,
      status: 'idle',
      disabled: false,
      previewCollapsed: false,
    },
  };
}

function materializeTemplate(
  template: { nodes: StudioNode[]; edges: Edge[] },
  options: WorkflowTemplateOptions,
): { nodes: StudioNode[]; edges: Edge[] } {
  const idMap = new Map<string, string>();
  const minX = Math.min(...template.nodes.map((node) => node.position.x));
  const minY = Math.min(...template.nodes.map((node) => node.position.y));
  const delta = options.origin ? { x: options.origin.x - minX, y: options.origin.y - minY } : { x: 0, y: 0 };

  const nodes = template.nodes.map((node) => {
    const nextId = options.idPrefix ? `${options.idPrefix}-${node.id}` : node.id;
    idMap.set(node.id, nextId);
    return {
      ...node,
      id: nextId,
      selected: Boolean(options.selected),
      position: {
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      },
      data: {
        ...node.data,
        params: cloneJsonish(node.data.params),
        status: node.data.disabled ? ('skipped' as const) : ('idle' as const),
      },
    };
  });

  const edges = template.edges.map((edge) => ({
    ...edge,
    id: options.idPrefix ? `${options.idPrefix}-${edge.id}` : edge.id,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
    selected: Boolean(options.selected),
    markerEnd: cloneJsonish(edge.markerEnd),
    data: edge.data ? cloneJsonish(edge.data) : edge.data,
  }));

  return { nodes, edges };
}

function defaultEdge(id: string, source: string, target: string, sourceHandle: string, targetHandle: string): Edge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    className: 'workflow-edge edge-ready',
    markerEnd: { type: MarkerType.ArrowClosed },
    interactionWidth: 24,
    reconnectable: true,
  };
}

export function workflowPayloadToCanvas(workflow: WorkflowPayload): { nodes: StudioNode[]; edges: StudioEdge[] } {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: 'studio',
      position: node.position,
      data: {
        label: String(node.data.label ?? node.id),
        nodeType: node.type,
        params: (node.data.params ?? {}) as Record<string, unknown>,
        disabled: Boolean(node.data.disabled),
        previewCollapsed: Boolean(node.data.previewCollapsed),
        status: Boolean(node.data.disabled) ? 'skipped' : 'idle',
      },
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id ?? `${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: normalizeGraphHandle(edge.sourceHandle),
      targetHandle: normalizeGraphHandle(edge.targetHandle),
      className: 'workflow-edge edge-ready',
      markerEnd: { type: MarkerType.ArrowClosed },
      interactionWidth: 24,
      reconnectable: true,
    })),
  };
}

function normalizeGraphHandle(handle: string | null | undefined): string | null {
  if (handle === 'truth_graph' || handle === 'pred_graph' || handle === 'result_graph') {
    return 'graph';
  }
  return handle ?? null;
}

function cloneJsonish<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
