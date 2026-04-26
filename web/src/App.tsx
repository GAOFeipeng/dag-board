import '@xyflow/react/dist/style.css';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, FolderOpen, Play, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
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
import {
  applyRunEventToEdges,
  applyRunEventToNodes,
  deleteNodeAndEdges,
  duplicateNode,
  getNodeInputStatus,
  preflightConnection,
  queueRunNodes,
  resetRunEdges,
  toggleNodeDisabled,
  validateWorkflowInputs,
} from './runState';
import { useStudioStore } from './store';
import type { ArtifactRecord, NodeTypeDefinition, RunEvent, RunOptions, StudioEdge, StudioNode as StudioNodeType, WorkflowPayload } from './types';

const defaults = createDefaultWorkflow();
const PREVIEW_STORAGE_KEY = 'dagboard.showNodePreviews';

type ContextMenuState = { nodeId: string; x: number; y: number } | null;

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

function StudioCanvas() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { t, i18n } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState(defaults.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaults.edges);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showNodePreviews, setShowNodePreviews] = useState(() => localStorage.getItem(PREVIEW_STORAGE_KEY) !== 'false');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
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
  const selectedNode = (nodes.find((node) => node.id === selectedNodeId) ?? null) as StudioNodeType | null;

  const updateInlineParam = useCallback(
    (nodeId: string, fieldName: string, value: unknown) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, params: { ...(node.data.params ?? {}), [fieldName]: value } } }
            : node,
        ),
      );
    },
    [setNodes],
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
            previewOutput: previewOutputForNode(nodeOutputs[node.id]),
            showPreview: showNodePreviews && Boolean(definition?.preview?.supported_outputs?.length) && !previewCollapsed,
            onInlineParamChange: updateInlineParam,
            onTogglePreview: toggleNodePreview,
          },
        };
      }),
    [edges, localizedNodeTypes, nodeOutputs, nodes, showNodePreviews, toggleNodePreview, updateInlineParam],
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
        if (eventName === 'completed' || eventName === 'failed' || eventName === 'run_completed' || eventName === 'run_failed') {
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
      setEdges((current) => addEdge({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}` }, current));
    },
    [edges, localizedNodeTypes, nodes, setEdges],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeTypeId = event.dataTransfer.getData('application/dagboard-node');
      const definition = localizedNodeTypes.find((item) => item.id === nodeTypeId);
      if (!definition) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const nextNode: StudioNodeType = {
        id: `${nodeTypeId}-${Date.now()}`,
        type: 'studio',
        position,
        data: {
          label: definition.label,
          nodeType: definition.id,
          params: defaultParams(definition),
          status: 'idle',
        },
      };
      setNodes((current) => [...current, nextNode]);
    },
    [localizedNodeTypes, screenToFlowPosition, setNodes],
  );

  const updateParams = useCallback(
    (nodeId: string, params: Record<string, unknown>) => {
      setNodes((current) =>
        current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, params } } : node)),
      );
    },
    [setNodes],
  );

  const loadWorkflow = useCallback(
    async (workflowId: string, workflow?: WorkflowPayload) => {
      const loaded = workflow ?? (await api.getWorkflow(workflowId));
      const canvas = workflowPayloadToCanvas(loaded);
      setNodes(canvas.nodes);
      setEdges(canvas.edges);
      setSelectedWorkflowId(workflowId);
      setSelectedNodeId(null);
      resetRun();
      setBrowserOpen(false);
    },
    [resetRun, setEdges, setNodes, setSelectedNodeId],
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
            <button onClick={toggleGlobalPreviews} title={showNodePreviews ? t('app.hidePreviews') : t('app.showPreviews')}>
              {showNodePreviews ? <Eye size={16} /> : <EyeOff size={16} />}
              {showNodePreviews ? t('app.previewsOn') : t('app.previewsOff')}
            </button>
            <button onClick={() => void api.saveWorkflow(toWorkflowPayload(nodes as StudioNodeType[], edges))} title={t('app.save')}>
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
              />
            </div>
          ) : null}
        </header>
        {validationError ? <div className="validation-banner">{validationError}</div> : null}
        <div className="canvas-wrap" ref={wrapperRef}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={(connection) =>
              preflightConnection({
                nodes: nodes as StudioNodeType[],
                edges: edges as StudioEdge[],
                connection,
                nodeTypes: localizedNodeTypes,
                enforceTypeCompatibility: true,
              }).valid
            }
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedNodeId(node.id);
              setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setContextMenu(null);
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
            nodeTypes={reactFlowNodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
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
                    setNodes((current) =>
                      current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, label } } : item)),
                    );
                  }
                },
                duplicate: (nodeId) => {
                  const result = duplicateNode(nodes as StudioNodeType[], nodeId);
                  setNodes(result.nodes);
                  if (result.node) setSelectedNodeId(result.node.id);
                },
                delete: (nodeId) => {
                  const result = deleteNodeAndEdges(nodes as StudioNodeType[], edges as StudioEdge[], nodeId);
                  setNodes(result.nodes);
                  setEdges(result.edges);
                  clearNodeOutputs(result.deletedNodeIds);
                  setSelectedNodeId(null);
                },
                toggleDisabled: (nodeId, disabled) => {
                  setNodes((current) => toggleNodeDisabled(current as StudioNodeType[], nodeId, disabled));
                },
                togglePreview: (nodeId) => toggleNodePreview(nodeId),
              }}
            />
          ) : null}
        </div>
        <div className="bottom-grid">
          <RunPanel
            events={events}
            runStatus={runStatus}
            nodeOutputs={nodeOutputs}
            selectedNodeId={selectedNodeId}
            manifest={manifest}
            artifacts={artifactsQuery.data ?? []}
            onOpenArtifact={(artifact) => void openArtifact(artifact)}
          />
          <GraphPreview graphView={graphView} />
        </div>
      </main>
      <InspectorPanel
        selectedNode={selectedNode}
        nodeTypes={localizedNodeTypes}
        algorithms={algorithmsQuery.data ?? []}
        onUpdate={updateParams}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <StudioCanvas />
    </ReactFlowProvider>
  );
}
