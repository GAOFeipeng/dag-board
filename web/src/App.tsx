import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnReconnect,
  type NodeTypes,
} from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, FolderOpen, LayoutGrid, Link2, Play, Redo2, RotateCcw, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import {
  autoLayoutCanvas,
  clearCanvasSelection,
  cloneCanvasSnapshot,
  copySelectionToClipboard,
  createCanvasHistory,
  deleteSelectionFromCanvas,
  editableTargetHasFocus,
  pasteClipboardToCanvas,
  pushCanvasHistory,
  redoCanvasHistory,
  restoreDefaultEdgesForCanvas,
  selectAllCanvas,
  selectedNodeIds,
  selectionSummary as getSelectionSummary,
  toggleDisabledForNodes,
  undoCanvasHistory,
  withEditableEdgeDefaults,
  type CanvasClipboard,
  type CanvasHistory,
  type CanvasSnapshot,
} from './canvasActions';
import { CanvasContextMenu } from './components/CanvasContextMenu';
import { GraphPreview } from './components/GraphPreview';
import { InspectorPanel } from './components/InspectorPanel';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { NodeContextMenu } from './components/NodeContextMenu';
import { NodePalette } from './components/NodePalette';
import { RunPanel, type ArtifactItem } from './components/RunPanel';
import { StudioNode } from './components/StudioNode';
import { WorkflowRunBrowser } from './components/WorkflowRunBrowser';
import { createDefaultWorkflow, defaultParams, toWorkflowPayload, workflowPayloadToCanvas } from './graph';
import { localizeNodeTypeCatalog } from './i18n';
import { transformNodeOutputForParams } from './outputTransforms';
import {
  applyRunEventToEdges,
  applyRunEventToNodes,
  getNodeInputStatus,
  preflightConnection,
  queueRunNodes,
  resetRunEdges,
  validateWorkflowInputs,
  type ConnectionPreflightResult,
} from './runState';
import { useStudioStore } from './store';
import type {
  ArtifactRecord,
  NodeTypeDefinition,
  RunComparePayload,
  RunEvent,
  RunOptions,
  StudioEdge,
  StudioNode as StudioNodeType,
  WorkflowPayload,
} from './types';

const PREVIEW_STORAGE_KEY = 'dagboard.showNodePreviews';
const DRAFT_STORAGE_KEY = 'dagboard.workflowDraft';

type ContextMenuState = { nodeId: string; x: number; y: number } | null;
type PaneMenuState = { x: number; y: number; flowPosition: { x: number; y: number } } | null;

function loadInitialCanvas(): CanvasSnapshot {
  if (typeof window === 'undefined') {
    return createDefaultWorkflow();
  }
  const draft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!draft) {
    return createDefaultWorkflow();
  }
  try {
    return workflowPayloadToCanvas(JSON.parse(draft) as WorkflowPayload);
  } catch {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    return createDefaultWorkflow();
  }
}

const defaults = loadInitialCanvas();

function disabledNodeIds(nodes: StudioNodeType[]): string[] {
  return nodes.filter((node) => node.data.disabled).map((node) => node.id);
}

function validateWorkflow(nodes: StudioNodeType[], edges: Edge[], nodeTypes: NodeTypeDefinition[]): string | null {
  return validateWorkflowInputs(nodes, edges as StudioEdge[], nodeTypes)[0] ?? null;
}

function previewOutputForNode(output: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!output) return null;
  if (isRecord(output.graph)) return output.graph;
  if (isRecord(output.graph_view)) return output.graph_view;
  if (isRecord(output.evaluation_summary)) return output.evaluation_summary;
  if (isRecord(output.evaluation)) return output.evaluation;
  if (isRecord(output.algorithm_result)) {
    const result = output.algorithm_result as Record<string, unknown>;
    return isRecord(result.result_graph) ? (result.result_graph as Record<string, unknown>) : result;
  }
  if (isRecord(output.data)) return output.data;
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paramsWithPatch(node: StudioNodeType, patch: Record<string, unknown>): Record<string, unknown> {
  const current = node.data.params ?? {};
  const next = { ...current, ...patch };
  if (node.data.nodeType === 'algorithm' && typeof patch.algorithm_id === 'string' && patch.algorithm_id !== current.algorithm_id) {
    return { algorithm_id: patch.algorithm_id };
  }
  if (node.data.nodeType === 'evaluation_summary' && patch.primary_metric !== undefined && patch.primary_metric !== current.primary_metric) {
    next.sort_order = 'auto';
  }
  return next;
}

function StudioCanvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { t, i18n } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState(defaults.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaults.edges);
  void onNodesChange;
  void onEdgesChange;
  const historyRef = useRef<CanvasHistory>(createCanvasHistory());
  const clipboardRef = useRef<CanvasClipboard | null>(null);
  const dragSnapshotRef = useRef<CanvasSnapshot | null>(null);
  const lastConnectionResultRef = useRef<ConnectionPreflightResult | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [paneMenu, setPaneMenu] = useState<PaneMenuState>(null);
  const [canPaste, setCanPaste] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showNodePreviews, setShowNodePreviews] = useState(() => localStorage.getItem(PREVIEW_STORAGE_KEY) !== 'false');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedCompareRunIds, setSelectedCompareRunIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<RunComparePayload | null>(null);
  const nodeTypesQuery = useQuery({ queryKey: ['node-types'], queryFn: api.nodeTypes });
  const algorithmsQuery = useQuery({ queryKey: ['algorithms'], queryFn: api.algorithms });
  const workflowsQuery = useQuery({ queryKey: ['workflows'], queryFn: api.workflows });
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const {
    selectedNodeId,
    setSelectedNodeId,
    events,
    nodeOutputs,
    runId,
    runStatus,
    startRun,
    addEvent,
    graphView,
    manifest,
    setManifest,
    setGraphView,
    clearNodeOutputs,
    resetRun,
  } = useStudioStore();
  const artifactsQuery = useQuery({
    queryKey: ['artifacts', runId],
    queryFn: () => api.artifacts(runId as string),
    enabled: Boolean(runId),
  });

  const localizedNodeTypes = useMemo(
    () => localizeNodeTypeCatalog(nodeTypesQuery.data ?? []),
    [nodeTypesQuery.data, i18n.resolvedLanguage, i18n.language],
  );
  const reactFlowNodeTypes: NodeTypes = useMemo(() => ({ studio: StudioNode }), []);
  const defaultEdgeOptions = useMemo(
    () => ({
      className: 'workflow-edge edge-ready',
      markerEnd: { type: MarkerType.ArrowClosed },
      interactionWidth: 24,
      reconnectable: true,
    }),
    [],
  );
  const selectedNode = (nodes.find((node) => node.id === selectedNodeId) ?? null) as StudioNodeType | null;
  const displayNodeOutputs = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(nodeOutputs).map(([nodeId, output]) => {
          const node = (nodes as StudioNodeType[]).find((item) => item.id === nodeId);
          return [nodeId, transformNodeOutputForParams(output, node?.data.params) ?? output];
        }),
      ),
    [nodeOutputs, nodes],
  );
  const selectedNodeOutput = selectedNodeId ? displayNodeOutputs[selectedNodeId] ?? null : null;
  const currentSelection = useMemo(
    () => getSelectionSummary({ nodes: nodes as StudioNodeType[], edges: edges as StudioEdge[] }),
    [edges, nodes],
  );

  const currentCanvas = useCallback(
    (): CanvasSnapshot => ({ nodes: nodes as StudioNodeType[], edges: edges as StudioEdge[] }),
    [edges, nodes],
  );

  const applyCanvas = useCallback(
    (snapshot: CanvasSnapshot, options: { clearRemovedOutputs?: boolean } = {}) => {
      const currentNodeIds = new Set((nodes as StudioNodeType[]).map((node) => node.id));
      const nextNodeIds = new Set(snapshot.nodes.map((node) => node.id));
      const removedNodeIds = [...currentNodeIds].filter((nodeId) => !nextNodeIds.has(nodeId));
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      const nextSelectedNode = snapshot.nodes.find((node) => node.selected) ?? null;
      setSelectedNodeId(nextSelectedNode?.id ?? null);
      if (options.clearRemovedOutputs && removedNodeIds.length) {
        clearNodeOutputs(removedNodeIds);
      }
    },
    [clearNodeOutputs, nodes, setEdges, setNodes, setSelectedNodeId],
  );

  const commitCanvas = useCallback(
    (snapshot: CanvasSnapshot, options: { deletedNodeIds?: string[]; selectNodeId?: string | null } = {}) => {
      const before = currentCanvas();
      historyRef.current = pushCanvasHistory(historyRef.current, before, snapshot);
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      if (options.selectNodeId !== undefined) {
        setSelectedNodeId(options.selectNodeId);
      } else {
        setSelectedNodeId(snapshot.nodes.find((node) => node.selected)?.id ?? null);
      }
      if (options.deletedNodeIds?.length) {
        clearNodeOutputs(options.deletedNodeIds);
      }
      setValidationError(null);
    },
    [clearNodeOutputs, currentCanvas, setEdges, setNodes, setSelectedNodeId],
  );

  const undoCanvas = useCallback(() => {
    const result = undoCanvasHistory(historyRef.current, currentCanvas());
    historyRef.current = result.history;
    if (result.snapshot) {
      applyCanvas(result.snapshot, { clearRemovedOutputs: true });
      setValidationError(null);
    }
  }, [applyCanvas, currentCanvas]);

  const redoCanvas = useCallback(() => {
    const result = redoCanvasHistory(historyRef.current, currentCanvas());
    historyRef.current = result.history;
    if (result.snapshot) {
      applyCanvas(result.snapshot, { clearRemovedOutputs: true });
      setValidationError(null);
    }
  }, [applyCanvas, currentCanvas]);

  const updateInlineParam = useCallback(
    (nodeId: string, fieldName: string, value: unknown) => {
      const nextNodes = (nodes as StudioNodeType[]).map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, params: paramsWithPatch(node as StudioNodeType, { [fieldName]: value }) } }
          : node,
      );
      commitCanvas({ nodes: nextNodes, edges: edges as StudioEdge[] });
    },
    [commitCanvas, edges, nodes],
  );

  const toggleNodePreview = useCallback(
    (nodeId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const definition = localizedNodeTypes.find((item) => item.id === node.data.nodeType);
          const defaultCollapsed = !Boolean(definition?.preview?.enabled_by_default);
          const currentCollapsed = node.data.previewCollapsed ?? defaultCollapsed;
          return { ...node, data: { ...node.data, previewCollapsed: !currentCollapsed } };
        }),
      );
    },
    [localizedNodeTypes, setNodes],
  );

  const toggleGlobalPreviews = useCallback(() => {
    setShowNodePreviews((current) => {
      const next = !current;
      localStorage.setItem(PREVIEW_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(toWorkflowPayload(nodes as StudioNodeType[], edges)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [edges, nodes]);

  const displayNodes = useMemo(
    () =>
      (nodes as StudioNodeType[]).map((node) => {
        const definition = localizedNodeTypes.find((item) => item.id === node.data.nodeType);
        const inlineNames = new Set(definition?.inline_fields ?? []);
        const defaultPreviewEnabled = Boolean(definition?.preview?.enabled_by_default);
        const previewCollapsed = node.data.previewCollapsed ?? !defaultPreviewEnabled;
        return {
          ...node,
          data: {
            ...node.data,
            inputStatus: getNodeInputStatus(node, nodes as StudioNodeType[], edges as StudioEdge[], localizedNodeTypes),
            inputPorts: definition?.input_ports ?? [],
            outputPorts: definition?.output_ports ?? [],
            inlineFields: (definition?.fields ?? []).filter((field) => inlineNames.has(field.name)),
            previewOutput: previewOutputForNode(displayNodeOutputs[node.id]),
            showPreview: showNodePreviews && Boolean(definition?.preview?.supported_outputs?.length) && !previewCollapsed,
            onInlineParamChange: updateInlineParam,
            onTogglePreview: toggleNodePreview,
          },
        };
      }),
    [displayNodeOutputs, edges, localizedNodeTypes, nodes, showNodePreviews, toggleNodePreview, updateInlineParam],
  );
  const contextMenuNode = contextMenu ? ((displayNodes.find((node) => node.id === contextMenu.nodeId) ?? null) as StudioNodeType | null) : null;

  const connectEvents = useCallback(
    (activeRunId: string) => {
      const seenIndexes = new Set<number>();
      let lastIndex = -1;
      let terminal = false;
      let polling = false;
      let pollTimer: number | undefined;

      const handleEvent = (event: RunEvent) => {
        if (typeof event.index === 'number' && seenIndexes.has(event.index)) {
          return;
        }
        if (typeof event.index === 'number') {
          seenIndexes.add(event.index);
          lastIndex = Math.max(lastIndex, event.index);
        }
        addEvent(event);
        setNodes((current) => applyRunEventToNodes(current as StudioNodeType[], event));
        setEdges((current) => applyRunEventToEdges(current as StudioEdge[], event));
        const eventName = String(event.type || event.event).replaceAll('.', '_');
        if (
          eventName === 'completed' ||
          eventName === 'failed' ||
          eventName === 'cancelled' ||
          eventName === 'run_completed' ||
          eventName === 'run_failed' ||
          eventName === 'run_cancelled'
        ) {
          terminal = true;
          if (pollTimer !== undefined) {
            window.clearInterval(pollTimer);
          }
          void artifactsQuery.refetch();
          void runsQuery.refetch();
        }
      };

      const pollEvents = async () => {
        if (terminal) return;
        const rows = await api.getEvents(activeRunId, lastIndex);
        rows.forEach(handleEvent);
      };

      const startPolling = () => {
        if (polling || terminal) return;
        polling = true;
        void pollEvents();
        pollTimer = window.setInterval(() => void pollEvents(), 700);
      };

      const socket = new WebSocket(api.eventsUrl(activeRunId));
      socket.onmessage = (message) => {
        handleEvent(JSON.parse(message.data));
      };
      socket.onerror = () => startPolling();
      socket.onclose = () => {
        if (!terminal) startPolling();
      };
      window.setTimeout(() => {
        if (seenIndexes.size === 0 && !terminal) startPolling();
      }, 1200);
    },
    [addEvent, artifactsQuery, runsQuery, setEdges, setNodes],
  );

  const saveAndRun = useCallback(
    async (options: RunOptions = {}) => {
      const issue = validateWorkflow(nodes as StudioNodeType[], edges, localizedNodeTypes);
      if (issue) {
        setValidationError(`${t('app.preflightFailed')} ${issue}`);
        return;
      }
      setValidationError(null);
      setNodes((current) => queueRunNodes(current as StudioNodeType[]));
      setEdges((current) => resetRunEdges(current as StudioEdge[]));
      const saved = await api.saveWorkflow(toWorkflowPayload(nodes as StudioNodeType[], edges));
      if (!saved.id) {
        throw new Error('Backend did not return a workflow id.');
      }
      setSelectedWorkflowId(saved.id);
      const started = await api.startRun(saved.id, {
        ...options,
        disabled_node_ids: disabledNodeIds(nodes as StudioNodeType[]),
      });
      startRun(started.run_id);
      setSelectedRunId(started.run_id);
      connectEvents(started.run_id);
      void runsQuery.refetch();
      void workflowsQuery.refetch();
    },
    [connectEvents, edges, localizedNodeTypes, nodes, runsQuery, setEdges, setNodes, startRun, t, workflowsQuery],
  );

  const saveWorkflow = useCallback(async () => {
    const saved = await api.saveWorkflow(toWorkflowPayload(nodes as StudioNodeType[], edges));
    if (saved.id) {
      setSelectedWorkflowId(saved.id);
      void workflowsQuery.refetch();
    }
  }, [edges, nodes, workflowsQuery]);

  const copyWorkflow = useCallback(async () => {
    const payload = JSON.stringify(toWorkflowPayload(nodes as StudioNodeType[], edges), null, 2);
    await navigator.clipboard.writeText(payload);
    setValidationError(t('app.workflowCopied'));
  }, [edges, nodes, t]);

  const resetDefaultWorkflow = useCallback(() => {
    const next = createDefaultWorkflow();
    commitCanvas(next, { deletedNodeIds: (nodes as StudioNodeType[]).map((node) => node.id), selectNodeId: null });
    setSelectedWorkflowId(null);
    setSelectedRunId(null);
    setValidationError(null);
    resetRun();
  }, [commitCanvas, nodes, resetRun]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = preflightConnection({
        nodes: nodes as StudioNodeType[],
        edges: edges as StudioEdge[],
        connection,
        nodeTypes: localizedNodeTypes,
        enforceTypeCompatibility: true,
      });
      if (!result.valid) {
        setValidationError(result.message);
        return;
      }
      setValidationError(null);
      const nextEdge = withEditableEdgeDefaults({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}` } as Edge);
      commitCanvas({ nodes: nodes as StudioNodeType[], edges: [...(edges as StudioEdge[]), nextEdge] });
    },
    [commitCanvas, edges, localizedNodeTypes, nodes],
  );

  const restoreDefaultEdges = useCallback(() => {
    commitCanvas(restoreDefaultEdgesForCanvas(currentCanvas(), localizedNodeTypes));
  }, [commitCanvas, currentCanvas, localizedNodeTypes]);

  const onReconnect = useCallback<OnReconnect<Edge>>(
    (oldEdge, newConnection) => {
      const result = preflightConnection({
        nodes: nodes as StudioNodeType[],
        edges: edges as StudioEdge[],
        connection: newConnection,
        nodeTypes: localizedNodeTypes,
        ignoreEdgeId: oldEdge.id,
        enforceTypeCompatibility: true,
      });
      if (!result.valid) {
        setValidationError(result.message);
        return;
      }
      setValidationError(null);
      const nextEdges = reconnectEdge(oldEdge, newConnection, edges as Edge[], { shouldReplaceId: false }).map((edge) =>
        edge.id === oldEdge.id ? withEditableEdgeDefaults({ ...edge, data: { ...(edge.data ?? {}), status: 'ready' } }) : edge,
      );
      commitCanvas({ nodes: nodes as StudioNodeType[], edges: nextEdges as StudioEdge[] });
    },
    [commitCanvas, edges, localizedNodeTypes, nodes],
  );

  const addNodeAt = useCallback(
    (nodeTypeId: string, position: { x: number; y: number }) => {
      const definition = localizedNodeTypes.find((item) => item.id === nodeTypeId);
      if (!definition) return;
      const nextNode: StudioNodeType = {
        id: `${nodeTypeId}-${Date.now()}`,
        type: 'studio',
        position,
        selected: true,
        data: {
          label: definition.label,
          nodeType: definition.id,
          params: defaultParams(definition),
          status: 'idle',
        },
      };
      commitCanvas({
        nodes: [...(nodes as StudioNodeType[]).map((node) => ({ ...node, selected: false })), nextNode],
        edges: (edges as StudioEdge[]).map((edge) => ({ ...edge, selected: false })),
      }, { selectNodeId: nextNode.id });
    },
    [commitCanvas, edges, localizedNodeTypes, nodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeTypeId = event.dataTransfer.getData('application/dagboard-node');
      addNodeAt(nodeTypeId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNodeAt, screenToFlowPosition],
  );

  const updateParams = useCallback(
    (nodeId: string, params: Record<string, unknown>) => {
      commitCanvas(
        {
          nodes: (nodes as StudioNodeType[]).map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, params: paramsWithPatch(node as StudioNodeType, params) } } : node,
          ),
          edges: edges as StudioEdge[],
        },
      );
    },
    [commitCanvas, edges, nodes],
  );

  const uploadImportForNode = useCallback(
    async (nodeId: string, file: File) => {
      try {
        const imported = await api.uploadImport(file);
        commitCanvas(
          {
            nodes: (nodes as StudioNodeType[]).map((node) =>
              node.id === nodeId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      params: {
                        ...(node.data.params ?? {}),
                        import_id: imported.import_id,
                        has_header: imported.suffix === '.csv' ? node.data.params?.has_header ?? true : node.data.params?.has_header,
                      },
                    },
                  }
                : node,
            ),
            edges: edges as StudioEdge[],
          },
          { selectNodeId: nodeId },
        );
        setValidationError(`Imported ${imported.filename} as ${imported.import_id}.`);
      } catch (error) {
        setValidationError(error instanceof Error ? error.message : String(error));
      }
    },
    [commitCanvas, edges, nodes],
  );

  const cancelActiveRun = useCallback(async () => {
    if (!runId) return;
    const loaded = await api.cancelRun(runId);
    setManifest(loaded);
    void runsQuery.refetch();
  }, [runId, runsQuery, setManifest]);

  const exportRunReport = useCallback(async () => {
    if (!runId) return;
    try {
      await api.reportFromRun(runId);
      await artifactsQuery.refetch();
      setValidationError('Report artifacts were generated for the current run.');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
    }
  }, [artifactsQuery, runId]);

  const toggleCompareRun = useCallback((nextRunId: string) => {
    setSelectedCompareRunIds((current) =>
      current.includes(nextRunId) ? current.filter((item) => item !== nextRunId) : [...current, nextRunId],
    );
  }, []);

  const compareSelectedRuns = useCallback(async () => {
    if (selectedCompareRunIds.length < 2) return;
    const payload = await api.runCompare(selectedCompareRunIds);
    setCompareResult(payload);
  }, [selectedCompareRunIds]);

  const loadWorkflow = useCallback(
    async (workflowId: string, workflow?: WorkflowPayload) => {
      const loaded = workflow ?? (await api.getWorkflow(workflowId));
      const canvas = workflowPayloadToCanvas(loaded);
      historyRef.current = createCanvasHistory();
      applyCanvas(canvas);
      setSelectedWorkflowId(workflowId);
      resetRun();
      setBrowserOpen(false);
    },
    [applyCanvas, resetRun],
  );

  const openRun = useCallback(
    async (nextRunId: string) => {
      const loaded = await api.getRun(nextRunId);
      setManifest(loaded);
      setSelectedRunId(nextRunId);
      setBrowserOpen(false);
      setNodes((current) =>
        current.map((node) => {
          const status = loaded.node_states?.[node.id]?.status;
          return status ? { ...node, data: { ...node.data, status } } : node;
        }),
      );
    },
    [setManifest, setNodes],
  );

  const openArtifact = useCallback(
    async (artifact: ArtifactItem) => {
      if (!runId || !artifact.id) return;
      const record = artifact.value as Partial<ArtifactRecord>;
      if (!record.artifact_id) return;
      const payload =
        record.kind === 'npz'
          ? await api.artifactPreview(runId, record.artifact_id, { rows: 8, cols: 8 })
          : await api.artifact(runId, record.artifact_id);
      const content = payload.content;
      if (content && typeof content === 'object' && 'nodes' in content && 'edges' in content) {
        setGraphView(content as Record<string, unknown>);
      }
      if (content && typeof content === 'object' && 'render_meta' in content) {
        setGraphView(content as Record<string, unknown>);
      }
      console.info('DAGBoard artifact preview', payload);
    },
    [runId, setGraphView],
  );

  const selectAll = useCallback(() => {
    const next = selectAllCanvas(currentCanvas());
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
  }, [currentCanvas, setEdges, setNodes, setSelectedNodeId]);

  const clearSelection = useCallback(() => {
    const next = clearCanvasSelection(currentCanvas());
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedNodeId(null);
    setContextMenu(null);
    setPaneMenu(null);
  }, [currentCanvas, setEdges, setNodes, setSelectedNodeId]);

  const copySelection = useCallback((nodeIds?: string[]) => {
    const clipboard = copySelectionToClipboard(currentCanvas(), nodeIds);
    if (!clipboard) {
      return;
    }
    clipboardRef.current = clipboard;
    setCanPaste(true);
  }, [currentCanvas]);

  const pasteClipboard = useCallback(
    (anchor?: { x: number; y: number }) => {
      const result = pasteClipboardToCanvas(currentCanvas(), clipboardRef.current, anchor ? { anchor } : undefined);
      if (!result.pastedNodeIds.length) {
        return;
      }
      commitCanvas(result, { selectNodeId: result.pastedNodeIds[0] });
    },
    [commitCanvas, currentCanvas],
  );

  const duplicateCurrentSelection = useCallback(
    (fallbackNodeId?: string) => {
      const snapshot = currentCanvas();
      const activeNodeIds = selectedNodeIds(snapshot.nodes);
      const nodeIds = activeNodeIds.length ? activeNodeIds : fallbackNodeId ? [fallbackNodeId] : [];
      const clipboard = copySelectionToClipboard(snapshot, nodeIds);
      if (!clipboard) {
        return;
      }
      const result = pasteClipboardToCanvas(snapshot, clipboard, { offset: { x: 44, y: 44 } });
      commitCanvas(result, { selectNodeId: result.pastedNodeIds[0] ?? null });
    },
    [commitCanvas, currentCanvas],
  );

  const deleteSelection = useCallback(
    (fallbackNodeId?: string) => {
      const snapshot = currentCanvas();
      const activeNodeIds = selectedNodeIds(snapshot.nodes);
      const result = deleteSelectionFromCanvas(
        snapshot,
        activeNodeIds.length ? activeNodeIds : fallbackNodeId ? [fallbackNodeId] : undefined,
      );
      if (!result.deletedNodeIds.length && !result.removedEdgeIds.length) {
        return;
      }
      commitCanvas(result, { deletedNodeIds: result.deletedNodeIds, selectNodeId: null });
    },
    [commitCanvas, currentCanvas],
  );

  const toggleDisabledSelection = useCallback(
    (fallbackNodeId: string, disabled: boolean) => {
      const snapshot = currentCanvas();
      const activeNodeIds = selectedNodeIds(snapshot.nodes);
      const nodeIds = activeNodeIds.includes(fallbackNodeId) ? activeNodeIds : [fallbackNodeId];
      commitCanvas({
        nodes: toggleDisabledForNodes(snapshot.nodes, nodeIds, disabled),
        edges: snapshot.edges,
      });
    },
    [commitCanvas, currentCanvas],
  );

  const autoLayoutSelection = useCallback(() => {
    const snapshot = currentCanvas();
    const nodeIds = selectedNodeIds(snapshot.nodes);
    commitCanvas(autoLayoutCanvas(snapshot, nodeIds.length > 1 ? nodeIds : undefined));
  }, [commitCanvas, currentCanvas]);

  const onNodesChangeWithHistory = useCallback(
    (changes: NodeChange[]) => {
      const positionFinished = changes.some((change) => change.type === 'position' && change.dragging === false);
      setNodes((current) => {
        const nextNodes = applyNodeChanges(changes, current) as StudioNodeType[];
        if (positionFinished && dragSnapshotRef.current) {
          historyRef.current = pushCanvasHistory(historyRef.current, dragSnapshotRef.current, {
            nodes: nextNodes,
            edges: edges as StudioEdge[],
          });
          dragSnapshotRef.current = null;
        }
        return nextNodes;
      });
    },
    [edges, setNodes],
  );

  const onEdgesChangeWithSelection = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => applyEdgeChanges(changes, current) as StudioEdge[]);
    },
    [setEdges],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: StudioNodeType[] }) => {
      const nextSelectedNodeId = selectedNodes.length === 1 ? selectedNodes[0].id : selectedNodes[0]?.id ?? null;
      if (useStudioStore.getState().selectedNodeId !== nextSelectedNodeId) {
        setSelectedNodeId(nextSelectedNodeId);
      }
    },
    [setSelectedNodeId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (editableTargetHasFocus(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      if (mod && key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoCanvas();
        } else {
          undoCanvas();
        }
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (mod && key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && key === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        duplicateCurrentSelection();
        return;
      }
      if (mod && key === 's') {
        event.preventDefault();
        void saveWorkflow();
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        void saveAndRun();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearSelection();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    clearSelection,
    copySelection,
    deleteSelection,
    duplicateCurrentSelection,
    pasteClipboard,
    redoCanvas,
    saveAndRun,
    saveWorkflow,
    selectAll,
    undoCanvas,
  ]);

  return (
    <div className="app-shell">
      <NodePalette nodeTypes={localizedNodeTypes} />
      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>DAGBoard</h1>
            <span>{t('app.subtitle')}</span>
          </div>
          <div className="toolbar">
            <LanguageSwitcher />
            <button onClick={() => setBrowserOpen((value) => !value)} title={t('app.browser')}>
              <FolderOpen size={16} />
              {t('app.browser')}
            </button>
            <button onClick={resetDefaultWorkflow} title={t('app.defaultWorkflow')}>
              <RotateCcw size={16} />
              {t('app.defaultWorkflow')}
            </button>
            <button onClick={restoreDefaultEdges} title={t('app.restoreEdges')}>
              <Link2 size={16} />
              {t('app.restoreEdges')}
            </button>
            <button onClick={autoLayoutSelection} title={t('app.autoLayout')}>
              <LayoutGrid size={16} />
              {t('app.autoLayout')}
            </button>
            <button onClick={undoCanvas} title={t('app.undo')}>
              <Undo2 size={16} />
              {t('app.undo')}
            </button>
            <button onClick={redoCanvas} title={t('app.redo')}>
              <Redo2 size={16} />
              {t('app.redo')}
            </button>
            <button onClick={() => void copyWorkflow()} title={t('app.copyWorkflow')}>
              <Copy size={16} />
              {t('app.copyWorkflow')}
            </button>
            <button onClick={toggleGlobalPreviews} title={showNodePreviews ? t('app.hidePreviews') : t('app.showPreviews')}>
              {showNodePreviews ? <Eye size={16} /> : <EyeOff size={16} />}
              {showNodePreviews ? t('app.previewsOn') : t('app.previewsOff')}
            </button>
            <button onClick={() => void saveWorkflow()} title={t('app.save')}>
              <Save size={16} />
              {t('app.save')}
            </button>
            <button className="primary" onClick={() => void saveAndRun()} title={t('app.run')}>
              <Play size={16} />
              {t('app.run')}
            </button>
          </div>
          {browserOpen ? (
            <div className="browser-popover">
              <WorkflowRunBrowser
                workflows={workflowsQuery.data ?? []}
                runs={runsQuery.data ?? []}
                selectedWorkflowId={selectedWorkflowId}
                selectedRunId={selectedRunId}
                selectedCompareRunIds={selectedCompareRunIds}
                workflowFilter={workflowFilter}
                runFilter={runFilter}
                isLoadingWorkflows={workflowsQuery.isLoading}
                isLoadingRuns={runsQuery.isLoading}
                onWorkflowFilterChange={setWorkflowFilter}
                onRunFilterChange={setRunFilter}
                onRefreshWorkflows={() => void workflowsQuery.refetch()}
                onRefreshRuns={() => void runsQuery.refetch()}
                onLoadWorkflow={(workflowId, workflow) => void loadWorkflow(workflowId, workflow as WorkflowPayload)}
                onOpenRun={(nextRunId) => void openRun(nextRunId)}
                onToggleRunCompare={toggleCompareRun}
                onCompareRuns={() => void compareSelectedRuns()}
              />
              {compareResult ? (
                <RunComparePreview payload={compareResult} csvUrl={api.runCompareCsvUrl(compareResult.run_ids)} />
              ) : null}
            </div>
          ) : null}
        </header>
        {validationError ? <div className="validation-banner">{validationError}</div> : null}
        <div className="canvas-wrap" ref={wrapperRef}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChangeWithHistory}
            onEdgesChange={onEdgesChangeWithSelection}
            onConnect={onConnect}
            onConnectStart={() => {
              lastConnectionResultRef.current = null;
              setValidationError(t('app.connectHint'));
            }}
            onConnectEnd={() => {
              if (lastConnectionResultRef.current && !lastConnectionResultRef.current.valid) {
                setValidationError(`${t('app.connectFailed')} ${lastConnectionResultRef.current.message}`);
              } else {
                setValidationError(null);
              }
              lastConnectionResultRef.current = null;
            }}
            onReconnect={onReconnect}
            defaultEdgeOptions={defaultEdgeOptions}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={36}
            connectOnClick
            deleteKeyCode={null}
            edgesReconnectable
            reconnectRadius={12}
            elevateEdgesOnSelect
            connectionLineStyle={{ stroke: '#80c7f4', strokeWidth: 2.4 }}
            isValidConnection={(connection) => {
              const result = preflightConnection({
                nodes: nodes as StudioNodeType[],
                edges: edges as StudioEdge[],
                connection,
                nodeTypes: localizedNodeTypes,
                enforceTypeCompatibility: true,
              });
              lastConnectionResultRef.current = result;
              return result.valid;
            }}
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onNodeDragStart={() => {
              dragSnapshotRef.current = cloneCanvasSnapshot(currentCanvas());
            }}
            onSelectionChange={handleSelectionChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setContextMenu(null);
              setPaneMenu(null);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedNodeId(node.id);
              setPaneMenu(null);
              setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            onPaneClick={() => {
              clearSelection();
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
              setPaneMenu({
                x: event.clientX,
                y: event.clientY,
                flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              });
            }}
            nodeTypes={reactFlowNodeTypes}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          <div className="shortcut-hint">
            <strong>{t('shortcuts.title')}</strong>
            <span>{t('shortcuts.all')}</span>
          </div>
          {contextMenu && contextMenuNode ? (
            <NodeContextMenu
              node={contextMenuNode}
              position={{ x: contextMenu.x, y: contextMenu.y }}
              hasOutput={Boolean(nodeOutputs[contextMenuNode.id])}
              onClose={() => setContextMenu(null)}
              callbacks={{
                runToNode: (nodeId) => void saveAndRun({ target_node_id: nodeId, target_node_ids: [nodeId] }),
                viewOutput: (nodeId) => setSelectedNodeId(nodeId),
                rename: (nodeId, node) => {
                  const label = window.prompt(t('contextMenu.renamePrompt'), node.data.label);
                  if (label) {
                    commitCanvas({
                      nodes: (nodes as StudioNodeType[]).map((item) =>
                        item.id === nodeId ? { ...item, data: { ...item.data, label } } : item,
                      ),
                      edges: edges as StudioEdge[],
                    }, { selectNodeId: nodeId });
                  }
                },
                duplicate: (nodeId) => duplicateCurrentSelection(nodeId),
                delete: (nodeId) => deleteSelection(nodeId),
                toggleDisabled: (nodeId, disabled) => {
                  toggleDisabledSelection(nodeId, disabled);
                },
                togglePreview: (nodeId) => toggleNodePreview(nodeId),
              }}
            />
          ) : null}
          {paneMenu ? (
            <CanvasContextMenu
              position={{ x: paneMenu.x, y: paneMenu.y }}
              nodeTypes={localizedNodeTypes}
              canPaste={canPaste}
              onAddNode={(nodeTypeId) => addNodeAt(nodeTypeId, paneMenu.flowPosition)}
              onPaste={() => pasteClipboard(paneMenu.flowPosition)}
              onSelectAll={selectAll}
              onAutoLayout={autoLayoutSelection}
              onRestoreEdges={restoreDefaultEdges}
              onClearSelection={clearSelection}
              onClose={() => setPaneMenu(null)}
            />
          ) : null}
        </div>
        <div className="bottom-grid">
          <RunPanel
            events={events}
            runStatus={runStatus}
            nodeOutputs={displayNodeOutputs}
            selectedNodeId={selectedNodeId}
            manifest={manifest}
            artifacts={artifactsQuery.data ?? []}
            onOpenArtifact={(artifact) => void openArtifact(artifact)}
            onCancelRun={() => void cancelActiveRun()}
            onExportReport={() => void exportRunReport()}
          />
          <GraphPreview graphView={graphView} selectedNodeId={selectedNodeId} selectedOutput={selectedNodeOutput} />
        </div>
      </main>
      <InspectorPanel
        selectedNode={selectedNode}
        selectionSummary={currentSelection}
        nodeTypes={localizedNodeTypes}
        algorithms={algorithmsQuery.data ?? []}
        onUpdate={updateParams}
        onRename={(nodeId, label) => {
          commitCanvas({
            nodes: (nodes as StudioNodeType[]).map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label } } : node)),
            edges: edges as StudioEdge[],
          }, { selectNodeId: nodeId });
        }}
        onUploadImport={uploadImportForNode}
      />
    </div>
  );
}

function RunComparePreview({ payload, csvUrl }: { payload: RunComparePayload; csvUrl: string }) {
  const rows = payload.rows.slice(0, 8);
  const columns = ['run_id', 'node_id', 'algorithm', 'seed', 'f1', 'shd', 'precision', 'recall', 'runtime'].filter((column) =>
    payload.rows.some((row) => row[column] !== undefined),
  );
  return (
    <div className="compare-preview">
      <div className="panel-heading small">
        <span>Run Compare</span>
        <strong>{payload.row_count}</strong>
        <a href={csvUrl} target="_blank" rel="noreferrer">CSV</a>
      </div>
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.run_id ?? 'run'}-${row.node_id ?? 'node'}-${index}`}>
                {columns.map((column) => (
                  <td key={column}>{formatCell(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(4);
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '-';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function App() {
  return (
    <ReactFlowProvider>
      <StudioCanvas />
    </ReactFlowProvider>
  );
}
