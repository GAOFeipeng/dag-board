import { describe, expect, it } from 'vitest';
import type { RunEvent, StudioEdge, StudioNode } from './types';
import {
  applyRunEvent,
  applyRunEventToEdges,
  applyRunEventToNodes,
  buildRunToNodeSubgraph,
  deleteNodeAndEdges,
  duplicateNode,
  getNodeInputStatus,
  getUpstreamNodeIds,
  isNodeDisabled,
  preflightConnection,
  queueRunNodes,
  removeNodeOutputs,
  type RunStateSlice,
  toggleNodeDisabled,
  validateWorkflowInputs,
} from './runState';

function node(id: string, nodeType = 'algorithm'): StudioNode {
  return {
    id,
    type: 'studio',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      nodeType,
      params: { seed: 7 },
      status: 'idle',
    },
  };
}

function event(eventName: string, payload: Record<string, unknown> = {}): RunEvent {
  return {
    index: 0,
    event: eventName,
    run_id: 'run-1',
    timestamp: '2026-04-26T00:00:00Z',
    payload,
  };
}

describe('run-state reducers', () => {
  it('applies node lifecycle events to node statuses', () => {
    const nodes = [node('a'), node('b')];

    const running = applyRunEventToNodes(nodes, event('node_started', { node_id: 'a' }));
    expect(running.find((item) => item.id === 'a')?.data.status).toBe('running');
    expect(running.find((item) => item.id === 'b')?.data.status).toBe('idle');

    const completed = applyRunEventToNodes(running, event('node_completed', { node_id: 'a' }));
    expect(completed.find((item) => item.id === 'a')?.data.status).toBe('success');

    const failed = applyRunEventToNodes(completed, event('node_failed', { node_id: 'b' }));
    expect(failed.find((item) => item.id === 'b')?.data.status).toBe('failed');
  });

  it('animates incoming edges on start, outgoing edges on completion, and clears terminal events', () => {
    const edges: StudioEdge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
      { id: 'x-y', source: 'x', target: 'y' },
    ];

    const running = applyRunEventToEdges(edges, event('node_started', { node_id: 'b' }));
    expect(running.find((edge) => edge.id === 'a-b')?.animated).toBe(true);
    expect(running.find((edge) => edge.id === 'b-c')?.animated).toBe(false);
    expect(running.find((edge) => edge.id === 'x-y')?.animated).toBeFalsy();

    const outputFlow = applyRunEventToEdges(running, event('node_completed', { node_id: 'b' }));
    expect(outputFlow.find((edge) => edge.id === 'a-b')?.animated).toBe(false);
    expect(outputFlow.find((edge) => edge.id === 'b-c')?.animated).toBe(true);

    const completed = applyRunEventToEdges(outputFlow, event('completed'));
    expect(completed.some((edge) => edge.animated)).toBe(false);
  });

  it('accepts dotted event names and skipped/blocked node states', () => {
    const state = {
      nodes: [node('algo'), node('view')],
      edges: [{ id: 'algo-view', source: 'algo', target: 'view', animated: false }],
      runStatus: 'running' as const,
    };

    const running = applyRunEvent(state, event('node.started', { node_id: 'algo' }));
    expect(running.nodes.find((item) => item.id === 'algo')?.data.status).toBe('running');
    expect(running.edges.find((edge) => edge.id === 'algo-view')?.animated).toBe(false);

    const skipped = applyRunEvent(running, event('node.skipped', { node_id: 'view' }));
    expect(skipped.nodes.find((item) => item.id === 'view')?.data.status).toBe('skipped');

    const blocked = applyRunEvent(skipped, event('node.blocked', { node_id: 'view' }));
    expect(blocked.nodes.find((item) => item.id === 'view')?.data.status).toBe('blocked');

    const completed = applyRunEvent(blocked, event('run.completed'));
    expect(completed.runStatus).toBe('completed');
    expect(completed.edges.some((edge) => edge.animated)).toBe(false);
  });

  it('reduces outputs, graph view, events, and run status when present in state', () => {
    const state: RunStateSlice = {
      nodes: [node('view', 'graph_view')],
      edges: [],
      events: [],
      nodeOutputs: {},
      graphView: null,
      runStatus: 'running' as const,
    };

    const next = applyRunEvent(
      state,
      event('node_completed', {
        node_id: 'view',
        outputs: { kind: 'graph_view', graph_view: { nodes: [], edges: [] } },
      }),
    );

    expect(next.events).toHaveLength(1);
    expect(next.nodeOutputs?.view.kind).toBe('graph_view');
    expect(next.graphView).toEqual({ nodes: [], edges: [] });
    expect(next.runStatus).toBe('running');

    const done = applyRunEvent(next, event('completed'));
    expect(done.runStatus).toBe('completed');
  });

  it('queues nodes while keeping disabled nodes skipped', () => {
    const nodes = toggleNodeDisabled([node('a'), node('b')], 'b', true);
    const queued = queueRunNodes(nodes);

    expect(queued.find((item) => item.id === 'a')?.data.status).toBe('queued');
    expect(queued.find((item) => item.id === 'b')?.data.status).toBe('skipped');
  });
});

describe('connection preflight', () => {
  const nodes = [node('a', 'structure_generator'), node('b', 'data_generator'), node('c', 'algorithm')];
  const edges: StudioEdge[] = [
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-c', source: 'b', target: 'c' },
  ];

  it('accepts an acyclic non-duplicate connection', () => {
    const result = preflightConnection({ nodes, edges, connection: { source: 'a', target: 'c' } });
    expect(result.valid).toBe(true);
  });

  it('rejects missing endpoints, duplicate connections, and cycles', () => {
    expect(preflightConnection({ nodes, edges, connection: { source: null, target: 'a' } })).toMatchObject({
      valid: false,
      code: 'missing_endpoint',
    });
    expect(preflightConnection({ nodes, edges, connection: { source: 'a', target: 'b' } })).toMatchObject({
      valid: false,
      code: 'duplicate',
    });
    expect(preflightConnection({ nodes, edges, connection: { source: 'c', target: 'a' } })).toMatchObject({
      valid: false,
      code: 'cycle',
    });
  });

  it('can enforce node input/output compatibility', () => {
    const nodeTypes = [
      { id: 'structure_generator', label: 'Structure', description: '', inputs: [], outputs: ['graph'], fields: [] },
      { id: 'data_generator', label: 'Data', description: '', inputs: ['graph'], outputs: ['data'], fields: [] },
      { id: 'algorithm', label: 'Algorithm', description: '', inputs: ['data'], outputs: ['algorithm_result'], fields: [] },
    ];

    expect(
      preflightConnection({
        nodes,
        edges: [],
        connection: { source: 'a', target: 'b' },
        enforceTypeCompatibility: true,
        nodeTypes,
      }).valid,
    ).toBe(true);
    expect(
      preflightConnection({
        nodes,
        edges: [],
        connection: { source: 'a', target: 'c' },
        enforceTypeCompatibility: true,
        nodeTypes,
      }),
    ).toMatchObject({ valid: false, code: 'type_mismatch' });
  });

  it('validates typed ports and dynamic evaluation input requirements', () => {
    const typedNodes = [
      node('structure', 'structure_generator'),
      node('data', 'data_generator'),
      node('eval', 'evaluation'),
    ];
    const nodeTypes = [
      {
        id: 'structure_generator',
        label: 'Structure',
        description: '',
        inputs: [],
        outputs: ['graph'],
        fields: [],
        output_ports: [{ id: 'graph', label: 'Graph', kind: 'graph' }],
      },
      {
        id: 'data_generator',
        label: 'Data',
        description: '',
        inputs: ['graph'],
        outputs: ['data'],
        fields: [],
        input_ports: [{ id: 'graph', label: 'Graph', kind: 'graph', required: true }],
        output_ports: [
          { id: 'data', label: 'Data', kind: 'data' },
          { id: 'truth_graph', label: 'Truth', kind: 'graph_like' },
        ],
      },
      {
        id: 'evaluation',
        label: 'Eval',
        description: '',
        inputs: ['graph', 'data', 'algorithm_result'],
        outputs: ['evaluation'],
        fields: [],
        input_ports: [
          { id: 'truth_graph', label: 'Truth', kind: 'graph_like', required: true },
          { id: 'pred_graph', label: 'Pred', kind: 'graph_like', required: true },
          { id: 'data', label: 'Data', kind: 'data', required: false, min_count: 0 },
        ],
        output_ports: [{ id: 'evaluation', label: 'Evaluation', kind: 'evaluation' }],
      },
    ];
    const compareEdges: StudioEdge[] = [
      { id: 'structure-data', source: 'structure', target: 'data', sourceHandle: 'graph', targetHandle: 'graph' },
      { id: 'structure-eval', source: 'structure', target: 'eval', sourceHandle: 'graph', targetHandle: 'truth_graph' },
    ];

    expect(getNodeInputStatus(typedNodes[2], typedNodes, compareEdges, nodeTypes).missing).toEqual(['pred_graph']);
    expect(validateWorkflowInputs(typedNodes, compareEdges, nodeTypes)[0]).toContain('pred_graph');

    const bicNodes = typedNodes.map((item) =>
      item.id === 'eval' ? { ...item, data: { ...item.data, params: { mode: 'bic' } } } : item,
    );
    const bicEdges: StudioEdge[] = [
      ...compareEdges,
      { id: 'data-eval', source: 'data', target: 'eval', sourceHandle: 'data', targetHandle: 'data' },
    ];
    expect(getNodeInputStatus(bicNodes[2], bicNodes, bicEdges, nodeTypes)).toMatchObject({
      required: 2,
      satisfied: 2,
      missing: [],
    });
  });
});

describe('node action helpers', () => {
  it('duplicates a node with a unique id, offset position, cloned params, and reset status', () => {
    const source = node('algo');
    source.position = { x: 10, y: 20 };
    source.data.status = 'success';
    const result = duplicateNode([source, { ...node('algo-copy'), id: 'algo-copy' }], 'algo');

    expect(result.node?.id).toBe('algo-copy-2');
    expect(result.node?.position).toEqual({ x: 42, y: 52 });
    expect(result.node?.data.label).toBe('algo Copy');
    expect(result.node?.data.status).toBe('idle');
    expect(result.node?.data.params).toEqual(source.data.params);
    expect(result.node?.data.params).not.toBe(source.data.params);
  });

  it('deletes a node and its incident edges', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges: StudioEdge[] = [
      { id: 'a-b', source: 'a', target: 'b' },
      { id: 'b-c', source: 'b', target: 'c' },
      { id: 'a-c', source: 'a', target: 'c' },
    ];

    const result = deleteNodeAndEdges(nodes, edges, 'b');
    expect(result.nodes.map((item) => item.id)).toEqual(['a', 'c']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['a-c']);
    expect(result.removedEdges.map((edge) => edge.id)).toEqual(['a-b', 'b-c']);
  });

  it('toggles disabled state and removes stale outputs', () => {
    const [disabled] = toggleNodeDisabled([node('a')], 'a', true);
    expect(isNodeDisabled(disabled)).toBe(true);
    expect(disabled.data.status).toBe('skipped');

    const [enabled] = toggleNodeDisabled([disabled], 'a', false);
    expect(isNodeDisabled(enabled)).toBe(false);
    expect(enabled.data.status).toBe('idle');

    expect(removeNodeOutputs({ a: { value: 1 }, b: { value: 2 } }, ['a'])).toEqual({ b: { value: 2 } });
  });

  it('builds the upstream-only run-to-node subgraph', () => {
    const nodes = [node('structure'), node('data'), node('algo'), node('eval'), node('view')];
    const edges: StudioEdge[] = [
      { id: 'structure-data', source: 'structure', target: 'data' },
      { id: 'data-algo', source: 'data', target: 'algo' },
      { id: 'algo-eval', source: 'algo', target: 'eval' },
      { id: 'eval-view', source: 'eval', target: 'view' },
    ];

    expect([...getUpstreamNodeIds(nodes, edges, 'eval')].sort()).toEqual(['algo', 'data', 'eval', 'structure']);
    const subgraph = buildRunToNodeSubgraph(nodes, edges, 'eval');
    expect(subgraph.nodes.map((item) => item.id)).toEqual(['structure', 'data', 'algo', 'eval']);
    expect(subgraph.edges.map((edge) => edge.id)).toEqual(['structure-data', 'data-algo', 'algo-eval']);
  });
});
