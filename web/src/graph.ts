import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { NodeTypeDefinition, StudioEdge, StudioNode, WorkflowPayload } from './types';

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
      data: { label: 'PC Baseline', nodeType: 'algorithm', params: { algorithm_id: 'PC', alpha: 0.05, variant: 'original', w_threshold: 0.3, seed: 42 } },
    },
    {
      id: 'ges',
      type: 'studio',
      position: { x: 600, y: 240 },
      data: { label: 'GES Baseline', nodeType: 'algorithm', params: { algorithm_id: 'GES', criterion: 'bic', w_threshold: 0.3, seed: 42 } },
    },
    {
      id: 'notears',
      type: 'studio',
      position: { x: 600, y: 460 },
      data: { label: 'NOTEARS Baseline', nodeType: 'algorithm', params: { algorithm_id: 'Notears', lambda1: 0.03, max_iter: 20, w_threshold: 0.3, seed: 42 } },
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
  ];
  const edges: Edge[] = [
    defaultEdge('structure-data', 'structure', 'data', 'graph', 'graph'),
    defaultEdge('data-pc', 'data', 'pc', 'data', 'data'),
    defaultEdge('data-ges', 'data', 'ges', 'data', 'data'),
    defaultEdge('data-notears', 'data', 'notears', 'data', 'data'),
    defaultEdge('truth-eval-pc', 'data', 'eval-pc', 'truth_graph', 'truth_graph'),
    defaultEdge('truth-eval-ges', 'data', 'eval-ges', 'truth_graph', 'truth_graph'),
    defaultEdge('truth-eval-notears', 'data', 'eval-notears', 'truth_graph', 'truth_graph'),
    defaultEdge('pc-eval-pc', 'pc', 'eval-pc', 'result_graph', 'pred_graph'),
    defaultEdge('ges-eval-ges', 'ges', 'eval-ges', 'result_graph', 'pred_graph'),
    defaultEdge('notears-eval-notears', 'notears', 'eval-notears', 'result_graph', 'pred_graph'),
    defaultEdge('data-view-pc', 'data', 'view-pc', 'data', 'data'),
    defaultEdge('data-view-ges', 'data', 'view-ges', 'data', 'data'),
    defaultEdge('data-view-notears', 'data', 'view-notears', 'data', 'data'),
    defaultEdge('pc-view-pc', 'pc', 'view-pc', 'result_graph', 'graph'),
    defaultEdge('ges-view-ges', 'ges', 'view-ges', 'result_graph', 'graph'),
    defaultEdge('notears-view-notears', 'notears', 'view-notears', 'result_graph', 'graph'),
    defaultEdge('eval-pc-view-pc', 'eval-pc', 'view-pc', 'evaluation', 'evaluation'),
    defaultEdge('eval-ges-view-ges', 'eval-ges', 'view-ges', 'evaluation', 'evaluation'),
    defaultEdge('eval-notears-view-notears', 'eval-notears', 'view-notears', 'evaluation', 'evaluation'),
  ];
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
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}
