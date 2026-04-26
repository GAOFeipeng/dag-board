import { describe, expect, it } from 'vitest';

type CanvasState = {
  runStatus: string;
  nodes: Array<{ id: string; data: { status?: string } }>;
  edges: Array<{ id: string; source: string; target: string; animated?: boolean }>;
};

type RunReducer = (state: CanvasState, event: Record<string, unknown>) => CanvasState;

async function loadRunReducer(): Promise<RunReducer> {
  const candidates = ['./runState', './runReducer', './store', './graph'];
  for (const modulePath of candidates) {
    try {
      const module = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      const reducer =
        module.applyRunEventToCanvas ??
        module.reduceRunEvent ??
        module.runReducer;
      if (typeof reducer === 'function') {
        return reducer as RunReducer;
      }
    } catch {
      // Try the next candidate. The test below reports a single contract-level failure.
    }
  }
  throw new Error('v1.1 must expose applyRunEventToCanvas, reduceRunEvent, or runReducer');
}

function baseState(): CanvasState {
  return {
    runStatus: 'running',
    nodes: [
      { id: 'structure', data: { status: 'success' } },
      { id: 'data', data: { status: 'queued' } },
      { id: 'algo', data: { status: 'queued' } },
      { id: 'eval', data: { status: 'queued' } },
      { id: 'view', data: { status: 'queued' } },
    ],
    edges: [
      { id: 'structure-data', source: 'structure', target: 'data', animated: false },
      { id: 'data-algo', source: 'data', target: 'algo', animated: false },
      { id: 'data-eval', source: 'data', target: 'eval', animated: false },
      { id: 'algo-eval', source: 'algo', target: 'eval', animated: false },
      { id: 'eval-view', source: 'eval', target: 'view', animated: false },
    ],
  };
}

function runEvent(type: string, nodeId?: string) {
  return {
    index: 1,
    type,
    event: type.startsWith('run.') ? type.slice(4) : type.replace('.', '_'),
    level: type.endsWith('failed') ? 'error' : 'info',
    category: 'lifecycle',
    message: type,
    node_id: nodeId,
    payload: nodeId ? { node_id: nodeId } : {},
  };
}

function nodeStatus(state: CanvasState, nodeId: string) {
  return state.nodes.find((node) => node.id === nodeId)?.data.status;
}

function animatedEdges(state: CanvasState) {
  return state.edges.filter((edge) => edge.animated).map((edge) => edge.id).sort();
}

describe('run reducer', () => {
  it('animates incoming edges for the active node and clears them on terminal run events', async () => {
    const reduceRunEvent = await loadRunReducer();

    const runningData = reduceRunEvent(baseState(), runEvent('node.started', 'data'));
    expect(nodeStatus(runningData, 'data')).toBe('running');
    expect(animatedEdges(runningData)).toEqual(['structure-data']);

    const runningAlgo = reduceRunEvent(runningData, runEvent('node.started', 'algo'));
    expect(nodeStatus(runningAlgo, 'algo')).toBe('running');
    expect(animatedEdges(runningAlgo)).toEqual(['data-algo']);

    const completedData = reduceRunEvent(runningAlgo, runEvent('node.completed', 'data'));
    expect(nodeStatus(completedData, 'data')).toBe('success');
    expect(animatedEdges(completedData)).toEqual(['data-algo', 'data-eval']);

    const done = reduceRunEvent(completedData, runEvent('run.completed'));
    expect(done.runStatus).toBe('completed');
    expect(animatedEdges(done)).toEqual([]);
  });

  it('tracks skipped and blocked node events and clears animations on terminal run events', async () => {
    const reduceRunEvent = await loadRunReducer();

    let state = reduceRunEvent(baseState(), runEvent('node.started', 'algo'));
    expect(animatedEdges(state)).toEqual(['data-algo']);

    state = reduceRunEvent(state, runEvent('node.skipped', 'view'));
    expect(nodeStatus(state, 'view')).toBe('skipped');
    expect(animatedEdges(state)).toEqual(['data-algo']);

    state = reduceRunEvent(state, runEvent('node.blocked', 'eval'));
    expect(nodeStatus(state, 'eval')).toBe('blocked');

    state = reduceRunEvent(state, runEvent('run.completed'));
    expect(state.runStatus).toBe('completed');
    expect(animatedEdges(state)).toEqual([]);
  });
});
