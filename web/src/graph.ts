import type { Edge, Node } from '@xyflow/react';
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
      position: { x: 40, y: 80 },
      data: { label: 'Structure', nodeType: 'structure_generator', params: { d: 8, s0: 12, graph_type: 'ER', seed: 42 } },
    },
    {
      id: 'data',
      type: 'studio',
      position: { x: 300, y: 80 },
      data: { label: 'Data', nodeType: 'data_generator', params: { n_samples: 120, sem_type: 'gauss', sem_noise: 1, seed: 42, standardize: true } },
    },
    {
      id: 'pc',
      type: 'studio',
      position: { x: 560, y: 40 },
      data: { label: 'PC', nodeType: 'algorithm', params: { algorithm_id: 'PC', alpha: 0.05, variant: 'original', w_threshold: 0.3, seed: 42 } },
    },
    {
      id: 'evaluate',
      type: 'studio',
      position: { x: 820, y: 80 },
      data: { label: 'Evaluate', nodeType: 'evaluation', params: { mode: 'compare', threshold: 0.3, graph_space: 'dag' } },
    },
    {
      id: 'view',
      type: 'studio',
      position: { x: 1080, y: 80 },
      data: { label: 'Graph View', nodeType: 'graph_view', params: { compare_mode: 'overlay', threshold: 0.3, top_k: 200 } },
    },
  ];
  const edges: Edge[] = [
    { id: 'structure-data', source: 'structure', target: 'data', sourceHandle: 'graph', targetHandle: 'graph' },
    { id: 'data-pc', source: 'data', target: 'pc', sourceHandle: 'data', targetHandle: 'data' },
    { id: 'data-evaluate', source: 'data', target: 'evaluate', sourceHandle: 'truth_graph', targetHandle: 'truth_graph' },
    { id: 'pc-evaluate', source: 'pc', target: 'evaluate', sourceHandle: 'result_graph', targetHandle: 'pred_graph' },
    { id: 'data-view', source: 'data', target: 'view', sourceHandle: 'data', targetHandle: 'data' },
    { id: 'pc-view', source: 'pc', target: 'view', sourceHandle: 'result_graph', targetHandle: 'graph' },
    { id: 'evaluate-view', source: 'evaluate', target: 'view', sourceHandle: 'evaluation', targetHandle: 'evaluation' },
  ];
  return { nodes, edges };
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
