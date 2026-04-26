import type { NodeInputStatus, NodePort, NodeStatus, NodeTypeDefinition, RunEvent, RunStatus, StudioEdge, StudioNode } from './types';

export type NodeOutputMap = Record<string, Record<string, unknown>>;

export type DisableAwareNodeData = StudioNode['data'] & {
  disabled?: boolean;
};

export type RunStateSlice = {
  nodes: StudioNode[];
  edges: StudioEdge[];
  events?: RunEvent[];
  nodeOutputs?: NodeOutputMap;
  graphView?: Record<string, unknown> | null;
  runStatus?: RunStatus | 'idle';
};

export type CandidateConnection = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  id?: string | null;
};

export type ConnectionValidationCode =
  | 'missing_endpoint'
  | 'unknown_node'
  | 'self_loop'
  | 'disabled_node'
  | 'duplicate'
  | 'cycle'
  | 'type_mismatch';

export type ConnectionPreflightResult =
  | { valid: true; source: string; target: string }
  | { valid: false; code: ConnectionValidationCode; message: string; source?: string; target?: string };

export type ConnectionPreflightOptions = {
  nodes: Pick<StudioNode, 'id' | 'data'>[];
  edges: Array<Pick<StudioEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>;
  connection: CandidateConnection;
  allowDisabled?: boolean;
  compareHandles?: boolean;
  enforceTypeCompatibility?: boolean;
  ignoreEdgeId?: string | null;
  nodeTypes?: NodeTypeDefinition[];
};

export type DuplicateNodeOptions = {
  id?: string;
  offset?: { x: number; y: number };
  labelSuffix?: string;
  copyDisabled?: boolean;
  resetStatus?: boolean;
};

export type DuplicateNodeResult = {
  nodes: StudioNode[];
  node: StudioNode | null;
};

export type DeleteNodesResult = {
  nodes: StudioNode[];
  edges: StudioEdge[];
  deletedNodeIds: string[];
  removedEdges: StudioEdge[];
};

export function isNodeDisabled(node: Pick<StudioNode, 'data'>): boolean {
  return Boolean((node.data as DisableAwareNodeData).disabled);
}

export function setNodeStatus(nodes: StudioNode[], nodeId: string, status: NodeStatus): StudioNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId || node.data.status === status) {
      return node;
    }
    changed = true;
    return { ...node, data: { ...node.data, status } };
  });
  return changed ? nextNodes : nodes;
}

export function queueRunNodes(nodes: StudioNode[], skipDisabled = true): StudioNode[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      status: skipDisabled && isNodeDisabled(node) ? 'skipped' : 'queued',
    },
  }));
}

export function resetRunEdges(edges: StudioEdge[]): StudioEdge[] {
  let changed = false;
  const nextEdges = edges.map((edge) => {
    if (!edge.animated) {
      return edge;
    }
    changed = true;
    return { ...edge, animated: false };
  });
  return changed ? nextEdges : edges;
}

export function nodeStatusFromRunEvent(event: RunEvent): { nodeId: string; status: NodeStatus } | null {
  const nodeId = getEventNodeId(event);
  const eventName = normalizeEventName(event);
  if (!nodeId) {
    return null;
  }
  if (eventName === 'node_started') {
    return { nodeId, status: 'running' };
  }
  if (eventName === 'node_completed') {
    return { nodeId, status: 'success' };
  }
  if (eventName === 'node_failed') {
    return { nodeId, status: 'failed' };
  }
  if (eventName === 'node_skipped') {
    return { nodeId, status: 'skipped' };
  }
  if (eventName === 'node_blocked') {
    return { nodeId, status: 'blocked' };
  }
  return null;
}

export function runStatusFromRunEvent(current: RunStatus | 'idle', event: RunEvent): RunStatus | 'idle' {
  const eventName = normalizeEventName(event);
  if (eventName === 'queued' || eventName === 'running' || eventName === 'completed' || eventName === 'failed') {
    return eventName;
  }
  if (eventName === 'run_queued') {
    return 'queued';
  }
  if (eventName === 'run_running') {
    return 'running';
  }
  if (eventName === 'run_completed') {
    return 'completed';
  }
  if (eventName === 'run_failed') {
    return 'failed';
  }
  return current;
}

export function applyRunEventToNodes(nodes: StudioNode[], event: RunEvent): StudioNode[] {
  const nextStatus = nodeStatusFromRunEvent(event);
  if (!nextStatus) {
    return nodes;
  }
  return setNodeStatus(nodes, nextStatus.nodeId, nextStatus.status);
}

export function applyRunEventToEdges(edges: StudioEdge[], event: RunEvent): StudioEdge[] {
  const nodeId = getEventNodeId(event);
  const eventName = normalizeEventName(event);
  if (eventName === 'node_started' && nodeId) {
    const inputEdgeIds = getPayloadEdgeIds(event, 'input_edges');
    return edges.map((edge) => {
      const edgeId = edge.id ?? `${edge.source}->${edge.target}`;
      const shouldAnimate = inputEdgeIds.size ? inputEdgeIds.has(edgeId) : edge.target === nodeId;
      return setEdgeRuntime(edge, shouldAnimate ? 'flowing' : edgeRuntimeStatus(edge, 'waiting'), shouldAnimate);
    });
  }

  if (eventName === 'node_completed' && nodeId) {
    const outputEdgeIds = getPayloadEdgeIds(event, 'output_edges');
    return edges.map((edge) => {
      if (edge.target === nodeId) {
        return setEdgeRuntime(edge, 'delivered', false);
      }
      const edgeId = edge.id ?? `${edge.source}->${edge.target}`;
      const shouldAnimate = outputEdgeIds.size ? outputEdgeIds.has(edgeId) : edge.source === nodeId;
      if (shouldAnimate) {
        return setEdgeRuntime(edge, 'flowing', true);
      }
      return edge.animated ? setEdgeRuntime(edge, edgeRuntimeStatus(edge, 'ready'), false) : edge;
    });
  }

  if (
    nodeId &&
    (eventName === 'node_failed' || eventName === 'node_skipped' || eventName === 'node_blocked')
  ) {
    return edges.map((edge) => {
      if (edge.target === nodeId || edge.source === nodeId) {
        const status = eventName === 'node_failed' && edge.target === nodeId ? 'failed' : 'blocked';
        return setEdgeRuntime(edge, status, false);
      }
      return edge;
    });
  }

  if (eventName === 'completed' || eventName === 'failed' || eventName === 'run_completed' || eventName === 'run_failed') {
    return resetRunEdges(edges);
  }

  return edges;
}

export function applyRunEventOutputs(
  nodeOutputs: NodeOutputMap,
  graphView: Record<string, unknown> | null,
  event: RunEvent,
): { nodeOutputs: NodeOutputMap; graphView: Record<string, unknown> | null } {
  const nodeId = getEventNodeId(event);
  if (normalizeEventName(event) !== 'node_completed' || !nodeId) {
    return { nodeOutputs, graphView };
  }

  const outputs = getEventOutputs(event);
  const nextOutputs = { ...nodeOutputs, [nodeId]: outputs };
  const nextGraphView =
    outputs.kind === 'graph_view' && isRecord(outputs.graph_view) ? (outputs.graph_view as Record<string, unknown>) : graphView;
  return { nodeOutputs: nextOutputs, graphView: nextGraphView };
}

export function applyRunEvent<TState extends RunStateSlice>(state: TState, event: RunEvent): TState {
  const outputState =
    state.nodeOutputs !== undefined
      ? applyRunEventOutputs(state.nodeOutputs, state.graphView ?? null, event)
      : { nodeOutputs: state.nodeOutputs, graphView: state.graphView };

  return {
    ...state,
    nodes: applyRunEventToNodes(state.nodes, event),
    edges: applyRunEventToEdges(state.edges, event),
    events: state.events ? [...state.events, event] : state.events,
    nodeOutputs: outputState.nodeOutputs,
    graphView: outputState.graphView,
    runStatus: state.runStatus ? runStatusFromRunEvent(state.runStatus, event) : state.runStatus,
  } as TState;
}

export function preflightConnection({
  nodes,
  edges,
  connection,
  allowDisabled = false,
  compareHandles = false,
  enforceTypeCompatibility,
  ignoreEdgeId = null,
  nodeTypes,
}: ConnectionPreflightOptions): ConnectionPreflightResult {
  const shouldEnforceTypeCompatibility = enforceTypeCompatibility ?? Boolean(nodeTypes);
  const source = connection.source ?? undefined;
  const target = connection.target ?? undefined;
  if (!source || !target) {
    return { valid: false, code: 'missing_endpoint', message: 'Connection requires both source and target nodes.', source, target };
  }
  if (source === target) {
    return { valid: false, code: 'self_loop', message: 'Connection cannot target the same node.', source, target };
  }

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) {
    return { valid: false, code: 'unknown_node', message: 'Connection references a missing node.', source, target };
  }
  if (!allowDisabled && (isNodeDisabled(sourceNode) || isNodeDisabled(targetNode))) {
    return { valid: false, code: 'disabled_node', message: 'Connection cannot include a disabled node.', source, target };
  }
  if (isDuplicateConnection(edges, connection, {
    compareHandles: compareHandles || Boolean(connection.sourceHandle || connection.targetHandle),
    ignoreEdgeId,
  })) {
    return { valid: false, code: 'duplicate', message: 'Connection already exists.', source, target };
  }
  if (wouldCreateCycle(nodes, edges, source, target, ignoreEdgeId)) {
    return { valid: false, code: 'cycle', message: 'Connection would create a cycle.', source, target };
  }
  if (
    shouldEnforceTypeCompatibility &&
    nodeTypes &&
    !areNodeTypesConnectable(sourceNode, targetNode, nodeTypes, connection)
  ) {
    return { valid: false, code: 'type_mismatch', message: 'Incompatible source outputs and target inputs.', source, target };
  }
  return { valid: true, source, target };
}

export function validateConnection(options: ConnectionPreflightOptions): ConnectionPreflightResult {
  return preflightConnection({
    ...options,
    enforceTypeCompatibility: options.enforceTypeCompatibility ?? Boolean(options.nodeTypes),
  });
}

export function isValidConnection(options: ConnectionPreflightOptions): boolean {
  return preflightConnection(options).valid;
}

export function isDuplicateConnection(
  edges: Array<Pick<StudioEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>,
  connection: CandidateConnection,
  options: { compareHandles?: boolean; ignoreEdgeId?: string | null } = {},
): boolean {
  const source = connection.source ?? undefined;
  const target = connection.target ?? undefined;
  if (!source || !target) {
    return false;
  }

  return edges.some((edge) => {
    if (options.ignoreEdgeId && edge.id === options.ignoreEdgeId) {
      return false;
    }
    if (edge.source !== source || edge.target !== target) {
      return false;
    }
    if (!options.compareHandles) {
      return true;
    }
    return normalizeHandle(edge.sourceHandle) === normalizeHandle(connection.sourceHandle) && normalizeHandle(edge.targetHandle) === normalizeHandle(connection.targetHandle);
  });
}

export function wouldCreateCycle(
  nodes: Pick<StudioNode, 'id'>[],
  edges: Array<Pick<StudioEdge, 'id' | 'source' | 'target'>>,
  source: string,
  target: string,
  ignoreEdgeId: string | null = null,
): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (source === target) {
    return true;
  }
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    return false;
  }

  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    if (ignoreEdgeId && edge.id === ignoreEdgeId) {
      continue;
    }
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)?.push(edge.target);
    }
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

export function areNodeTypesConnectable(
  sourceNode: Pick<StudioNode, 'data'>,
  targetNode: Pick<StudioNode, 'data'>,
  nodeTypes: NodeTypeDefinition[],
  connection: Pick<CandidateConnection, 'sourceHandle' | 'targetHandle'> = {},
): boolean {
  const sourceDefinition = nodeTypes.find((definition) => definition.id === sourceNode.data.nodeType);
  const targetDefinition = nodeTypes.find((definition) => definition.id === targetNode.data.nodeType);
  if (!sourceDefinition || !targetDefinition) {
    return true;
  }
  const outputs = getOutputPorts(sourceDefinition, connection.sourceHandle);
  const inputs = getInputPorts(targetDefinition, connection.targetHandle);
  if (!outputs.length || !inputs.length) {
    return false;
  }
  return outputs.some((output) => inputs.some((input) => arePortKindsCompatible(output.kind, input.kind)));
}

export function getNodeInputStatus(
  node: StudioNode,
  nodes: StudioNode[],
  edges: StudioEdge[],
  nodeTypes: NodeTypeDefinition[],
): NodeInputStatus {
  const definition = nodeTypes.find((item) => item.id === node.data.nodeType);
  if (!definition) {
    return { required: 0, satisfied: 0, missing: [] };
  }
  const incoming = edges.filter((edge) => edge.target === node.id);
  if (definition.id === 'evaluation') {
    return getEvaluationInputStatus(node, nodes, incoming, nodeTypes);
  }

  const requiredPorts = getInputPorts(definition).filter((port) => port.required !== false && minCount(port) > 0);
  let required = 0;
  let satisfied = 0;
  const missing: string[] = [];
  for (const port of requiredPorts) {
    const needed = minCount(port);
    const count = countCompatibleInputs(port, incoming, nodes, nodeTypes);
    required += needed;
    satisfied += Math.min(count, needed);
    if (count < needed) {
      missing.push(port.id);
    }
  }
  return { required, satisfied, missing };
}

export function validateWorkflowInputs(
  nodes: StudioNode[],
  edges: StudioEdge[],
  nodeTypes: NodeTypeDefinition[],
): string[] {
  const issues: string[] = [];
  for (const edge of edges) {
    const result = preflightConnection({
      nodes,
      edges,
      nodeTypes,
      connection: edge,
      ignoreEdgeId: edge.id,
      enforceTypeCompatibility: true,
    });
    if (!result.valid) {
      issues.push(`${edge.source} -> ${edge.target}: ${result.message}`);
    }
  }

  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const status = getNodeInputStatus(node, nodes, edges, nodeTypes);
    if (status.missing.length) {
      issues.push(`${node.data.label}: ${status.satisfied}/${status.required} required, missing: ${status.missing.join(', ')}`);
    }
  }
  return issues;
}

export function renameNode(nodes: StudioNode[], nodeId: string, label: string): StudioNode[] {
  const nextLabel = label.trim();
  if (!nextLabel) {
    return nodes;
  }
  return nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label: nextLabel } } : node));
}

export function duplicateNode(nodes: StudioNode[], nodeId: string, options: DuplicateNodeOptions = {}): DuplicateNodeResult {
  const sourceNode = nodes.find((node) => node.id === nodeId);
  if (!sourceNode) {
    return { nodes, node: null };
  }

  const existingIds = new Set(nodes.map((node) => node.id));
  const nextId = uniqueNodeId(options.id ?? `${sourceNode.id}-copy`, existingIds);
  const offset = options.offset ?? { x: 32, y: 32 };
  const nextData: DisableAwareNodeData = {
    ...sourceNode.data,
    label: `${sourceNode.data.label}${options.labelSuffix ?? ' Copy'}`,
    params: cloneJsonish(sourceNode.data.params),
    status: options.resetStatus === false ? sourceNode.data.status : 'idle',
  };

  if (options.copyDisabled) {
    nextData.disabled = isNodeDisabled(sourceNode);
  } else {
    delete nextData.disabled;
  }

  const nextNode: StudioNode = {
    ...sourceNode,
    id: nextId,
    selected: false,
    position: {
      x: sourceNode.position.x + offset.x,
      y: sourceNode.position.y + offset.y,
    },
    data: nextData,
  };
  return { nodes: [...nodes, nextNode], node: nextNode };
}

export function deleteNodeAndEdges(nodes: StudioNode[], edges: StudioEdge[], nodeId: string): DeleteNodesResult {
  return deleteNodesAndEdges(nodes, edges, [nodeId]);
}

export function deleteNodesAndEdges(nodes: StudioNode[], edges: StudioEdge[], nodeIds: Iterable<string>): DeleteNodesResult {
  const deleteIds = new Set(nodeIds);
  const deletedNodeIds = nodes.filter((node) => deleteIds.has(node.id)).map((node) => node.id);
  const nextNodes = nodes.filter((node) => !deleteIds.has(node.id));
  const removedEdges = edges.filter((edge) => deleteIds.has(edge.source) || deleteIds.has(edge.target));
  const nextEdges = edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target));
  return { nodes: nextNodes, edges: nextEdges, deletedNodeIds, removedEdges };
}

export function toggleNodeDisabled(nodes: StudioNode[], nodeId: string, disabled?: boolean): StudioNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const nextDisabled = disabled ?? !isNodeDisabled(node);
    const currentStatus = node.data.status;
    const nextStatus: NodeStatus | undefined = nextDisabled ? 'skipped' : currentStatus === 'skipped' ? 'idle' : currentStatus;
    return {
      ...node,
      data: {
        ...node.data,
        disabled: nextDisabled,
        status: nextStatus,
      },
    };
  });
}

export function removeNodeOutputs(nodeOutputs: NodeOutputMap, nodeIds: Iterable<string>): NodeOutputMap {
  const removeIds = new Set(nodeIds);
  let changed = false;
  const nextOutputs: NodeOutputMap = {};
  for (const [nodeId, output] of Object.entries(nodeOutputs)) {
    if (removeIds.has(nodeId)) {
      changed = true;
      continue;
    }
    nextOutputs[nodeId] = output;
  }
  return changed ? nextOutputs : nodeOutputs;
}

export function getUpstreamNodeIds(nodes: Pick<StudioNode, 'id'>[], edges: Array<Pick<StudioEdge, 'source' | 'target'>>, targetNodeId: string): Set<string> {
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const upstream = new Map<string, string[]>();
  for (const nodeId of knownNodeIds) {
    upstream.set(nodeId, []);
  }
  for (const edge of edges) {
    if (knownNodeIds.has(edge.source) && knownNodeIds.has(edge.target)) {
      upstream.get(edge.target)?.push(edge.source);
    }
  }
  if (!knownNodeIds.has(targetNodeId)) {
    return new Set();
  }

  const result = new Set<string>();
  const stack = [targetNodeId];
  while (stack.length) {
    const current = stack.pop()!;
    if (result.has(current)) {
      continue;
    }
    result.add(current);
    for (const parent of upstream.get(current) ?? []) {
      stack.push(parent);
    }
  }
  return result;
}

export function buildRunToNodeSubgraph(nodes: StudioNode[], edges: StudioEdge[], targetNodeId: string): { nodes: StudioNode[]; edges: StudioEdge[] } {
  const nodeIds = getUpstreamNodeIds(nodes, edges, targetNodeId);
  return {
    nodes: nodes.filter((node) => nodeIds.has(node.id)),
    edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function getEvaluationInputStatus(
  node: StudioNode,
  nodes: StudioNode[],
  incoming: StudioEdge[],
  nodeTypes: NodeTypeDefinition[],
): NodeInputStatus {
  const mode = String(node.data.params?.mode ?? 'compare');
  if (mode === 'bic') {
    const graphCount = countIncomingByKind(incoming, nodes, nodeTypes, 'graph_like', ['graph', 'truth_graph', 'pred_graph']);
    const dataCount = countIncomingByKind(incoming, nodes, nodeTypes, 'data', ['data']);
    const missing: string[] = [];
    if (graphCount < 1) missing.push('graph');
    if (dataCount < 1) missing.push('data');
    return { required: 2, satisfied: Math.min(graphCount, 1) + Math.min(dataCount, 1), missing };
  }

  const hasTargetHandles = incoming.some((edge) => Boolean(edge.targetHandle));
  if (hasTargetHandles) {
    const legacyTruthCount = countIncomingByKind(incoming, nodes, nodeTypes, 'graph_like', ['truth_graph']);
    const legacyPredCount = countIncomingByKind(incoming, nodes, nodeTypes, 'graph_like', ['pred_graph']);
    if (legacyTruthCount || legacyPredCount) {
      const missing: string[] = [];
      if (legacyTruthCount < 1) missing.push('truth_graph');
      if (legacyPredCount < 1) missing.push('pred_graph');
      return { required: 2, satisfied: Math.min(legacyTruthCount, 1) + Math.min(legacyPredCount, 1), missing };
    }
    const graphCount = countIncomingByKind(incoming, nodes, nodeTypes, 'graph_like', ['graph']);
    return {
      required: 2,
      satisfied: Math.min(graphCount, 2),
      missing: graphCount >= 2 ? [] : [`graph x${2 - graphCount}`],
    };
  }

  const graphCount = countIncomingByKind(incoming, nodes, nodeTypes, 'graph_like');
  return {
    required: 2,
    satisfied: Math.min(graphCount, 2),
    missing: graphCount >= 2 ? [] : [`graph x${2 - graphCount}`],
  };
}

function countCompatibleInputs(
  port: NodePort,
  incoming: StudioEdge[],
  nodes: StudioNode[],
  nodeTypes: NodeTypeDefinition[],
): number {
  return incoming.filter((edge) => {
    if (edge.targetHandle && edge.targetHandle !== port.id) {
      return false;
    }
    return edgeSourceKinds(edge, nodes, nodeTypes).some((kind) => arePortKindsCompatible(kind, port.kind));
  }).length;
}

function countIncomingByKind(
  incoming: StudioEdge[],
  nodes: StudioNode[],
  nodeTypes: NodeTypeDefinition[],
  targetKind: string,
  targetHandles?: string[],
): number {
  const allowedHandles = targetHandles ? new Set(targetHandles) : null;
  return incoming.filter((edge) => {
    if (allowedHandles && edge.targetHandle && !allowedHandles.has(edge.targetHandle)) {
      return false;
    }
    if (allowedHandles && incoming.some((item) => Boolean(item.targetHandle)) && !allowedHandles.has(edge.targetHandle ?? '')) {
      return false;
    }
    return edgeSourceKinds(edge, nodes, nodeTypes).some((kind) => arePortKindsCompatible(kind, targetKind));
  }).length;
}

function edgeSourceKinds(edge: Pick<StudioEdge, 'source' | 'sourceHandle'>, nodes: StudioNode[], nodeTypes: NodeTypeDefinition[]): string[] {
  const sourceNode = nodes.find((item) => item.id === edge.source);
  const sourceDefinition = nodeTypes.find((definition) => definition.id === sourceNode?.data.nodeType);
  if (!sourceDefinition) {
    return [];
  }
  return getOutputPorts(sourceDefinition, edge.sourceHandle).map((port) => port.kind);
}

function getInputPorts(definition: NodeTypeDefinition, handle?: string | null): NodePort[] {
  const ports = definition.input_ports?.length
    ? definition.input_ports
    : definition.inputs.map((input) => ({ id: input, label: input, kind: input, required: true, min_count: 1, max_count: 1 }));
  if (!handle) {
    return ports;
  }
  return ports.filter((port) => port.id === handle);
}

function getOutputPorts(definition: NodeTypeDefinition, handle?: string | null): NodePort[] {
  const ports = definition.output_ports?.length
    ? definition.output_ports
    : definition.outputs.map((output) => ({ id: output, label: output, kind: output, required: false, min_count: 0, max_count: null }));
  if (!handle) {
    return ports;
  }
  return ports.filter((port) => port.id === handle);
}

function arePortKindsCompatible(sourceKind: string, targetKind: string): boolean {
  if (sourceKind === targetKind) {
    return true;
  }
  if (targetKind === 'graph_like' && ['graph_like', 'graph', 'data', 'algorithm_result'].includes(sourceKind)) {
    return true;
  }
  return false;
}

function minCount(port: NodePort): number {
  return Math.max(0, Number(port.min_count ?? (port.required === false ? 0 : 1)));
}

export const applyRunEventToCanvas = applyRunEvent;
export const reduceRunEvent = applyRunEvent;
export const runReducer = applyRunEvent;

function getEventNodeId(event: RunEvent): string | null {
  const payloadNodeId = event.payload?.node_id;
  if (typeof payloadNodeId === 'string' && payloadNodeId.length > 0) {
    return payloadNodeId;
  }
  const nodeId = (event as RunEvent & { node_id?: unknown }).node_id;
  return typeof nodeId === 'string' && nodeId.length > 0 ? nodeId : null;
}

function getEventOutputs(event: RunEvent): Record<string, unknown> {
  const outputs = event.payload?.outputs;
  return isRecord(outputs) ? outputs : {};
}

function normalizeHandle(handle: string | null | undefined): string | null {
  return handle ?? null;
}

function normalizeEventName(event: RunEvent): string {
  const rawEvent = (event as RunEvent & { type?: unknown }).event ?? (event as RunEvent & { type?: unknown }).type ?? '';
  return String(rawEvent).replaceAll('.', '_');
}

function clearConnectedEdgeAnimations(edges: StudioEdge[], nodeId: string): StudioEdge[] {
  let changed = false;
  const nextEdges = edges.map((edge) => {
    if (!edge.animated || (edge.source !== nodeId && edge.target !== nodeId)) {
      return edge;
    }
    changed = true;
    return { ...edge, animated: false };
  });
  return changed ? nextEdges : edges;
}

function setEdgeRuntime(edge: StudioEdge, status: string, animated: boolean): StudioEdge {
  if (edge.animated === animated && edge.data?.status === status) {
    return edge;
  }
  return {
    ...edge,
    animated,
    className: `workflow-edge edge-${status}`,
    data: { ...(edge.data ?? {}), status },
  };
}

function edgeRuntimeStatus(edge: StudioEdge, fallback: string): string {
  const status = edge.data?.status;
  return typeof status === 'string' ? status : fallback;
}

function getPayloadEdgeIds(event: RunEvent, key: 'input_edges' | 'output_edges'): Set<string> {
  const rows = event.payload?.[key];
  const result = new Set<string>();
  if (!Array.isArray(rows)) {
    return result;
  }
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const edgeId = row.edge_id;
    if (typeof edgeId === 'string' && edgeId) {
      result.add(edgeId);
    }
  }
  return result;
}

function uniqueNodeId(baseId: string, existingIds: Set<string>): string {
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
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
