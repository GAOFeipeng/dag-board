import { MarkerType, type Edge } from '@xyflow/react';
import { createDefaultWorkflow } from './graph';
import { deleteNodesAndEdges, preflightConnection, toggleNodeDisabled } from './runState';
import type { NodeTypeDefinition, StudioEdge, StudioNode } from './types';

export type CanvasSnapshot = {
  nodes: StudioNode[];
  edges: StudioEdge[];
};

export type CanvasHistory = {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
  limit: number;
};

export type CanvasClipboard = {
  nodes: StudioNode[];
  edges: StudioEdge[];
};

export type DeleteSelectionResult = CanvasSnapshot & {
  deletedNodeIds: string[];
  removedEdgeIds: string[];
};

export type PasteSelectionResult = CanvasSnapshot & {
  pastedNodeIds: string[];
  pastedEdgeIds: string[];
};

export function createCanvasHistory(limit = 80): CanvasHistory {
  return { past: [], future: [], limit };
}

export function cloneCanvasSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map(cloneNode),
    edges: snapshot.edges.map(cloneEdge),
  };
}

export function pushCanvasHistory(
  history: CanvasHistory,
  before: CanvasSnapshot,
  after: CanvasSnapshot,
): CanvasHistory {
  if (canvasSnapshotsEqual(before, after)) {
    return history;
  }
  const past = [...history.past, cloneCanvasSnapshot(before)].slice(-history.limit);
  return { ...history, past, future: [] };
}

export function undoCanvasHistory(
  history: CanvasHistory,
  current: CanvasSnapshot,
): { history: CanvasHistory; snapshot: CanvasSnapshot | null } {
  const previous = history.past.at(-1);
  if (!previous) {
    return { history, snapshot: null };
  }
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [cloneCanvasSnapshot(current), ...history.future],
    },
    snapshot: cloneCanvasSnapshot(previous),
  };
}

export function redoCanvasHistory(
  history: CanvasHistory,
  current: CanvasSnapshot,
): { history: CanvasHistory; snapshot: CanvasSnapshot | null } {
  const next = history.future[0];
  if (!next) {
    return { history, snapshot: null };
  }
  return {
    history: {
      ...history,
      past: [...history.past, cloneCanvasSnapshot(current)].slice(-history.limit),
      future: history.future.slice(1),
    },
    snapshot: cloneCanvasSnapshot(next),
  };
}

export function withEditableEdgeDefaults(edge: Edge | StudioEdge): StudioEdge {
  return {
    ...edge,
    animated: false,
    className: 'workflow-edge edge-ready',
    markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed },
    interactionWidth: edge.interactionWidth ?? 28,
    reconnectable: edge.reconnectable ?? true,
    data: { ...(edge.data ?? {}), status: 'ready' },
  } as StudioEdge;
}

export function selectAllCanvas(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, selected: true })),
    edges: snapshot.edges.map((edge) => ({ ...edge, selected: true })),
  };
}

export function clearCanvasSelection(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, selected: false })),
    edges: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
  };
}

export function selectedNodeIds(nodes: StudioNode[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

export function selectedEdgeIds(edges: StudioEdge[]): string[] {
  return edges.filter((edge) => edge.selected).map((edge) => edge.id).filter(Boolean) as string[];
}

export function selectionSummary(snapshot: CanvasSnapshot): { nodeCount: number; edgeCount: number } {
  return {
    nodeCount: selectedNodeIds(snapshot.nodes).length,
    edgeCount: selectedEdgeIds(snapshot.edges).length,
  };
}

export function deleteSelectionFromCanvas(
  snapshot: CanvasSnapshot,
  nodeIds = selectedNodeIds(snapshot.nodes),
  edgeIds = selectedEdgeIds(snapshot.edges),
): DeleteSelectionResult {
  const edgeIdSet = new Set(edgeIds);
  const nodeDelete = deleteNodesAndEdges(snapshot.nodes, snapshot.edges, nodeIds);
  const removedSelectedEdges = nodeDelete.edges.filter((edge) => edge.id && edgeIdSet.has(edge.id));
  const edges = nodeDelete.edges.filter((edge) => !edge.id || !edgeIdSet.has(edge.id));
  return {
    nodes: nodeDelete.nodes,
    edges,
    deletedNodeIds: nodeDelete.deletedNodeIds,
    removedEdgeIds: [
      ...nodeDelete.removedEdges.map((edge) => edge.id).filter(Boolean),
      ...removedSelectedEdges.map((edge) => edge.id).filter(Boolean),
    ] as string[],
  };
}

export function copySelectionToClipboard(
  snapshot: CanvasSnapshot,
  nodeIds = selectedNodeIds(snapshot.nodes),
): CanvasClipboard | null {
  if (!nodeIds.length) {
    return null;
  }
  const copyIds = new Set(nodeIds);
  return {
    nodes: snapshot.nodes.filter((node) => copyIds.has(node.id)).map(cloneNode),
    edges: snapshot.edges
      .filter((edge) => copyIds.has(edge.source) && copyIds.has(edge.target))
      .map(cloneEdge),
  };
}

export function pasteClipboardToCanvas(
  snapshot: CanvasSnapshot,
  clipboard: CanvasClipboard | null,
  options: { offset?: { x: number; y: number }; anchor?: { x: number; y: number } } = {},
): PasteSelectionResult {
  if (!clipboard || !clipboard.nodes.length) {
    return { ...snapshot, pastedNodeIds: [], pastedEdgeIds: [] };
  }

  const offset = options.offset ?? { x: 44, y: 44 };
  const minX = Math.min(...clipboard.nodes.map((node) => node.position.x));
  const minY = Math.min(...clipboard.nodes.map((node) => node.position.y));
  const delta = options.anchor ? { x: options.anchor.x - minX, y: options.anchor.y - minY } : offset;
  const existingNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(snapshot.edges.map((edge) => edge.id).filter(Boolean) as string[]);
  const idMap = new Map<string, string>();

  const pastedNodes = clipboard.nodes.map((node) => {
    const nextId = uniqueId(`${node.id}-copy`, existingNodeIds);
    existingNodeIds.add(nextId);
    idMap.set(node.id, nextId);
    return {
      ...cloneNode(node),
      id: nextId,
      selected: true,
      position: {
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      },
      data: {
        ...node.data,
        label: `${node.data.label} Copy`,
        params: cloneJsonish(node.data.params),
        status: node.data.disabled ? 'skipped' : 'idle',
      },
    } satisfies StudioNode;
  });

  const pastedEdges = clipboard.edges
    .map((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) {
        return null;
      }
      const nextId = uniqueId(`${source}-${target}`, existingEdgeIds);
      existingEdgeIds.add(nextId);
      return withEditableEdgeDefaults({
        ...cloneEdge(edge),
        id: nextId,
        source,
        target,
        selected: true,
      });
    })
    .filter(Boolean) as StudioEdge[];

  return {
    nodes: [
      ...snapshot.nodes.map((node) => ({ ...node, selected: false })),
      ...pastedNodes,
    ],
    edges: [
      ...snapshot.edges.map((edge) => ({ ...edge, selected: false })),
      ...pastedEdges,
    ],
    pastedNodeIds: pastedNodes.map((node) => node.id),
    pastedEdgeIds: pastedEdges.map((edge) => edge.id).filter(Boolean) as string[],
  };
}

export function duplicateSelection(snapshot: CanvasSnapshot): PasteSelectionResult {
  return pasteClipboardToCanvas(snapshot, copySelectionToClipboard(snapshot), { offset: { x: 44, y: 44 } });
}

export function toggleDisabledForNodes(
  nodes: StudioNode[],
  nodeIds: string[],
  disabled: boolean,
): StudioNode[] {
  const ids = new Set(nodeIds);
  return nodes.reduce(
    (current, node) => (ids.has(node.id) ? toggleNodeDisabled(current, node.id, disabled) : current),
    nodes,
  );
}

export function restoreDefaultEdgesForCanvas(
  snapshot: CanvasSnapshot,
  nodeTypes: NodeTypeDefinition[],
): CanvasSnapshot {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(snapshot.edges.map((edge) => edge.id).filter(Boolean) as string[]);
  const nextEdges = [...snapshot.edges];

  for (const edge of createDefaultWorkflow().edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    const result = preflightConnection({
      nodes: snapshot.nodes,
      edges: nextEdges,
      connection: edge,
      nodeTypes,
      enforceTypeCompatibility: true,
    });
    if (!result.valid) {
      continue;
    }
    const id = edge.id ? uniqueId(edge.id, existingEdgeIds) : uniqueId(`${edge.source}-${edge.target}`, existingEdgeIds);
    existingEdgeIds.add(id);
    nextEdges.push(withEditableEdgeDefaults({ ...edge, id }));
  }

  return { nodes: snapshot.nodes, edges: nextEdges };
}

export function autoLayoutCanvas(snapshot: CanvasSnapshot, nodeIds?: string[]): CanvasSnapshot {
  const layoutIds = new Set(nodeIds?.length ? nodeIds : snapshot.nodes.map((node) => node.id));
  if (!layoutIds.size) {
    return snapshot;
  }
  const layoutNodes = snapshot.nodes.filter((node) => layoutIds.has(node.id));
  const baseX = Math.min(...layoutNodes.map((node) => node.position.x));
  const baseY = Math.min(...layoutNodes.map((node) => node.position.y));
  const layers = topologicalLayers(layoutNodes.map((node) => node.id), snapshot.edges);
  const positions = new Map<string, { x: number; y: number }>();
  const xGap = 310;
  const yGap = 230;

  layers.forEach((layer, layerIndex) => {
    const sortedLayer = [...layer].sort((a, b) => {
      const nodeA = snapshot.nodes.find((node) => node.id === a);
      const nodeB = snapshot.nodes.find((node) => node.id === b);
      return (nodeA?.position.y ?? 0) - (nodeB?.position.y ?? 0);
    });
    sortedLayer.forEach((nodeId, index) => {
      positions.set(nodeId, { x: baseX + layerIndex * xGap, y: baseY + index * yGap });
    });
  });

  return {
    nodes: snapshot.nodes.map((node) =>
      positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node,
    ),
    edges: snapshot.edges,
  };
}

export function editableTargetHasFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function topologicalLayers(nodeIds: string[], edges: StudioEdge[]): string[][] {
  const ids = new Set(nodeIds);
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      continue;
    }
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let ready = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const placed = new Set<string>();
  while (ready.length) {
    layers.push(ready);
    const nextReady: string[] = [];
    for (const id of ready) {
      placed.add(id);
      for (const target of outgoing.get(id) ?? []) {
        indegree.set(target, (indegree.get(target) ?? 0) - 1);
        if ((indegree.get(target) ?? 0) === 0) {
          nextReady.push(target);
        }
      }
    }
    ready = nextReady.filter((id) => !placed.has(id));
  }
  const remaining = nodeIds.filter((id) => !placed.has(id));
  if (remaining.length) {
    layers.push(remaining);
  }
  return layers;
}

function cloneNode(node: StudioNode): StudioNode {
  const {
    inputStatus,
    inlineFields,
    inputPorts,
    outputPorts,
    previewOutput,
    showPreview,
    onInlineParamChange,
    onTogglePreview,
    ...data
  } = node.data;
  void inputStatus;
  void inlineFields;
  void inputPorts;
  void outputPorts;
  void previewOutput;
  void showPreview;
  void onInlineParamChange;
  void onTogglePreview;
  return {
    ...node,
    data: {
      ...data,
      params: cloneJsonish(data.params),
    },
  };
}

function cloneEdge(edge: StudioEdge): StudioEdge {
  return {
    ...edge,
    markerEnd: cloneJsonish(edge.markerEnd),
    data: edge.data ? cloneJsonish(edge.data) : edge.data,
  };
}

function canvasSnapshotsEqual(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
  return JSON.stringify(comparableCanvas(left)) === JSON.stringify(comparableCanvas(right));
}

function comparableCanvas(snapshot: CanvasSnapshot) {
  return {
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      selected: Boolean(node.selected),
      data: {
        label: node.data.label,
        nodeType: node.data.nodeType,
        params: node.data.params,
        disabled: Boolean(node.data.disabled),
        previewCollapsed: Boolean(node.data.previewCollapsed),
      },
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      selected: Boolean(edge.selected),
    })),
  };
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }
  let index = 2;
  let candidate = `${baseId}-${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }
  return candidate;
}

function cloneJsonish<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
