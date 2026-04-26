import { create } from 'zustand';
import type { RunEvent, RunManifest, RunStatus } from './types';

function normalizedEventName(event: RunEvent): string {
  return String(event.type || event.event || '').replaceAll('.', '_');
}

function outputsFromManifest(manifest: RunManifest | null): Record<string, Record<string, unknown>> {
  if (!manifest) return {};
  return Object.fromEntries(
    Object.entries(manifest.node_states ?? {})
      .filter(([, record]) => record.outputs && Object.keys(record.outputs).length)
      .map(([nodeId, record]) => [nodeId, record.outputs]),
  );
}

function graphViewFromOutputs(outputs: Record<string, Record<string, unknown>>): Record<string, unknown> | null {
  for (const output of Object.values(outputs)) {
    if (output.kind === 'graph_view' && typeof output.graph_view === 'object' && output.graph_view !== null) {
      return output.graph_view as Record<string, unknown>;
    }
  }
  return null;
}

type StudioStore = {
  selectedNodeId: string | null;
  runId: string | null;
  runStatus: RunStatus | 'idle';
  events: RunEvent[];
  nodeOutputs: Record<string, Record<string, unknown>>;
  manifest: RunManifest | null;
  graphView: Record<string, unknown> | null;
  setSelectedNodeId: (id: string | null) => void;
  startRun: (runId: string) => void;
  addEvent: (event: RunEvent) => void;
  setManifest: (manifest: RunManifest | null) => void;
  setGraphView: (graphView: Record<string, unknown> | null) => void;
  clearNodeOutputs: (nodeIds: Iterable<string>) => void;
  resetRun: () => void;
};

export const useStudioStore = create<StudioStore>((set) => ({
  selectedNodeId: null,
  runId: null,
  runStatus: 'idle',
  events: [],
  nodeOutputs: {},
  manifest: null,
  graphView: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  startRun: (runId) => set({ runId, runStatus: 'queued', events: [], nodeOutputs: {}, graphView: null }),
  addEvent: (event) =>
    set((state) => {
      const nextOutputs = { ...state.nodeOutputs };
      let graphView = state.graphView;
      const payload = event.payload ?? {};
      if (normalizedEventName(event) === 'node_completed' && typeof payload.node_id === 'string') {
        const outputs = (payload.outputs ?? {}) as Record<string, unknown>;
        nextOutputs[payload.node_id] = outputs;
        if (outputs.kind === 'graph_view' && typeof outputs.graph_view === 'object' && outputs.graph_view !== null) {
          graphView = outputs.graph_view as Record<string, unknown>;
        }
      }
      const eventName = normalizedEventName(event);
      const runStatus =
        eventName === 'queued' || eventName === 'run_queued'
          ? 'queued'
          : eventName === 'running' || eventName === 'run_running'
            ? 'running'
            : eventName === 'completed' || eventName === 'run_completed'
              ? 'completed'
              : eventName === 'failed' || eventName === 'run_failed'
                ? 'failed'
                : state.runStatus;
      return { events: [...state.events, event], nodeOutputs: nextOutputs, graphView, runStatus };
    }),
  setManifest: (manifest) => {
    const nodeOutputs = outputsFromManifest(manifest);
    set({
      manifest,
      runStatus: manifest?.status ?? 'idle',
      events: manifest?.events ?? [],
      nodeOutputs,
      graphView: graphViewFromOutputs(nodeOutputs),
      runId: manifest?.run_id ?? null,
    });
  },
  setGraphView: (graphView) => set({ graphView }),
  clearNodeOutputs: (nodeIds) =>
    set((state) => {
      const remove = new Set(nodeIds);
      return {
        nodeOutputs: Object.fromEntries(Object.entries(state.nodeOutputs).filter(([nodeId]) => !remove.has(nodeId))),
      };
    }),
  resetRun: () => set({ runId: null, runStatus: 'idle', events: [], nodeOutputs: {}, manifest: null, graphView: null }),
}));
