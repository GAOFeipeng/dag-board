import { describe, expect, it } from 'vitest';
import {
  autoLayoutCanvas,
  copySelectionToClipboard,
  createCanvasHistory,
  deleteSelectionFromCanvas,
  pasteClipboardToCanvas,
  pushCanvasHistory,
  redoCanvasHistory,
  restoreDefaultEdgesForCanvas,
  selectAllCanvas,
  undoCanvasHistory,
} from './canvasActions';
import { createDefaultWorkflow } from './graph';
import type { StudioEdge, StudioNode } from './types';

function node(id: string, x = 0, y = 0, selected = false): StudioNode {
  return {
    id,
    type: 'studio',
    selected,
    position: { x, y },
    data: {
      label: id,
      nodeType: 'algorithm',
      params: { algorithm_id: 'PC' },
      status: 'idle',
    },
  };
}

function edge(id: string, source: string, target: string, selected = false): StudioEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    selected,
  };
}

describe('canvas actions', () => {
  it('selects all nodes and edges', () => {
    const selected = selectAllCanvas({ nodes: [node('a'), node('b')], edges: [edge('a-b', 'a', 'b')] });

    expect(selected.nodes.every((item) => item.selected)).toBe(true);
    expect(selected.edges.every((item) => item.selected)).toBe(true);
  });

  it('deletes selected nodes and selected loose edges', () => {
    const result = deleteSelectionFromCanvas({
      nodes: [node('a', 0, 0, true), node('b'), node('c')],
      edges: [edge('a-b', 'a', 'b'), edge('b-c', 'b', 'c', true)],
    });

    expect(result.nodes.map((item) => item.id)).toEqual(['b', 'c']);
    expect(result.edges).toEqual([]);
    expect(result.deletedNodeIds).toEqual(['a']);
    expect(result.removedEdgeIds.sort()).toEqual(['a-b', 'b-c']);
  });

  it('copies and pastes a selected subgraph with remapped ids and handles', () => {
    const snapshot = {
      nodes: [node('a', 10, 20, true), node('b', 200, 20, true), node('c')],
      edges: [
        { ...edge('a-b', 'a', 'b'), sourceHandle: 'data', targetHandle: 'data' },
        edge('b-c', 'b', 'c'),
      ],
    };
    const clipboard = copySelectionToClipboard(snapshot);
    const pasted = pasteClipboardToCanvas(snapshot, clipboard, { offset: { x: 40, y: 50 } });

    expect(pasted.pastedNodeIds).toEqual(['a-copy', 'b-copy']);
    expect(pasted.nodes.find((item) => item.id === 'a-copy')?.position).toEqual({ x: 50, y: 70 });
    expect(pasted.edges.find((item) => item.id === 'a-copy-b-copy')).toMatchObject({
      source: 'a-copy',
      target: 'b-copy',
      sourceHandle: 'data',
      targetHandle: 'data',
    });
    expect(pasted.edges.some((item) => item.source === 'b-copy' && item.target === 'c-copy')).toBe(false);
  });

  it('keeps undo and redo history independent from new edits', () => {
    const initial = { nodes: [node('a')], edges: [] };
    const afterAdd = { nodes: [node('a'), node('b')], edges: [] };
    let history = createCanvasHistory();

    history = pushCanvasHistory(history, initial, afterAdd);
    const undo = undoCanvasHistory(history, afterAdd);
    expect(undo.snapshot?.nodes.map((item) => item.id)).toEqual(['a']);

    const redo = redoCanvasHistory(undo.history, undo.snapshot!);
    expect(redo.snapshot?.nodes.map((item) => item.id)).toEqual(['a', 'b']);

    const afterDifferentEdit = { nodes: [node('a'), node('c')], edges: [] };
    const nextHistory = pushCanvasHistory(undo.history, undo.snapshot!, afterDifferentEdit);
    expect(nextHistory.future).toHaveLength(0);
  });

  it('restores only missing legal default edges', () => {
    const workflow = createDefaultWorkflow();
    const withoutTwoEdges = {
      nodes: workflow.nodes,
      edges: workflow.edges.slice(2),
    };
    const restored = restoreDefaultEdgesForCanvas(withoutTwoEdges, []);

    expect(restored.edges.some((item) => item.id === 'structure-data')).toBe(true);
    expect(restored.edges.some((item) => item.id === 'data-pc')).toBe(true);
    expect(restored.edges.filter((item) => item.id === 'data-ges')).toHaveLength(1);

    const withoutDataNode = {
      nodes: workflow.nodes.filter((item) => item.id !== 'data'),
      edges: [],
    };
    const restoredWithoutData = restoreDefaultEdgesForCanvas(withoutDataNode, []);
    expect(restoredWithoutData.edges.some((item) => item.source === 'data' || item.target === 'data')).toBe(false);
  });

  it('lays out selected nodes by graph layer', () => {
    const snapshot = {
      nodes: [node('c', 0, 300, true), node('a', 0, 0, true), node('b', 0, 150, true)],
      edges: [edge('a-b', 'a', 'b'), edge('b-c', 'b', 'c')],
    };

    const laidOut = autoLayoutCanvas(snapshot, ['a', 'b', 'c']);
    const a = laidOut.nodes.find((item) => item.id === 'a')!;
    const b = laidOut.nodes.find((item) => item.id === 'b')!;
    const c = laidOut.nodes.find((item) => item.id === 'c')!;

    expect(a.position.x).toBeLessThan(b.position.x);
    expect(b.position.x).toBeLessThan(c.position.x);
  });
});
