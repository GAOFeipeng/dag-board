import { describe, expect, it } from 'vitest';
import * as graphModule from './graph';
import * as runStateModule from './runState';
import {
  WORKFLOW_TEMPLATE_IDS,
  createDefaultWorkflow,
  createWorkflowTemplate,
  toWorkflowPayload,
  workflowPayloadToCanvas,
  wouldCreateCycle,
} from './graph';

type ValidationResult = {
  valid: boolean;
  code?: string;
  reason?: string;
  message?: string;
};

function studioNode(id: string, nodeType: string, disabled = false) {
  return {
    id,
    type: 'studio',
    position: { x: 0, y: 0 },
    data: { label: id, nodeType, params: {}, disabled },
  };
}

function reasonOf(result: ValidationResult) {
  return String(result.code ?? result.reason ?? result.message ?? '');
}

describe('workflow graph helpers', () => {
  it('detects a cycle before adding a connection', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    expect(wouldCreateCycle(nodes, edges, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(nodes, edges, 'a', 'c')).toBe(false);
  });

  it('serializes the default workflow with execution node types', () => {
    const workflow = createDefaultWorkflow();
    const payload = toWorkflowPayload(workflow.nodes, workflow.edges);
    expect(payload.nodes.map((node) => node.type)).toContain('structure_generator');
    expect(workflow.nodes.filter((node) => node.data.nodeType === 'algorithm').map((node) => node.data.params.algorithm_id)).toEqual([
      'PC',
      'GES',
      'Notears',
    ]);
    expect(workflow.nodes.find((node) => node.id === 'notears')?.data.params).toEqual({ algorithm_id: 'Notears' });
    expect(payload.nodes.filter((node) => node.type === 'evaluation')).toHaveLength(3);
    expect(payload.nodes.filter((node) => node.type === 'evaluation_summary')).toHaveLength(1);
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.edges.some((edge) => edge.sourceHandle && edge.targetHandle)).toBe(true);
    expect(payload.edges.filter((edge) => edge.targetHandle === 'graph' && edge.target.startsWith('eval-'))).toHaveLength(6);
    expect(payload.edges.some((edge) => edge.sourceHandle === 'truth_graph' || edge.sourceHandle === 'result_graph' || edge.targetHandle === 'pred_graph')).toBe(false);
    expect(payload.edges.filter((edge) => edge.target === 'summary')).toHaveLength(3);
  });

  it('normalizes legacy truth/result graph handles when loading workflows', () => {
    const canvas = workflowPayloadToCanvas({
      name: 'legacy',
      nodes: [
        { id: 'data', type: 'data_generator', position: { x: 0, y: 0 }, data: { label: 'Data' } },
        { id: 'algo', type: 'algorithm', position: { x: 0, y: 0 }, data: { label: 'Algo' } },
        { id: 'eval', type: 'evaluation', position: { x: 0, y: 0 }, data: { label: 'Eval' } },
      ],
      edges: [
        { id: 'truth', source: 'data', target: 'eval', sourceHandle: 'truth_graph', targetHandle: 'truth_graph' },
        { id: 'pred', source: 'algo', target: 'eval', sourceHandle: 'result_graph', targetHandle: 'pred_graph' },
      ],
    });

    expect(canvas.edges).toEqual([
      expect.objectContaining({ id: 'truth', sourceHandle: 'graph', targetHandle: 'graph' }),
      expect.objectContaining({ id: 'pred', sourceHandle: 'graph', targetHandle: 'graph' }),
    ]);
  });

  it('preserves per-node preview collapse state in workflow payloads', () => {
    const workflow = createDefaultWorkflow();
    workflow.nodes[0].data.previewCollapsed = true;
    const payload = toWorkflowPayload(workflow.nodes, workflow.edges);
    expect(payload.nodes[0].data.previewCollapsed).toBe(true);
  });

  it('keeps baseline comparison available through the shared template catalog', () => {
    const template = createWorkflowTemplate('baseline_compare');
    const defaultWorkflow = createDefaultWorkflow();

    expect(WORKFLOW_TEMPLATE_IDS).toEqual(['baseline_compare', 'residual_data_loop']);
    expect(toWorkflowPayload(template.nodes, template.edges)).toEqual(toWorkflowPayload(defaultWorkflow.nodes, defaultWorkflow.edges));
  });

  it('creates a residual data-loop template with editable graph and combined evaluation', () => {
    const workflow = createWorkflowTemplate('residual_data_loop');
    const payload = toWorkflowPayload(workflow.nodes, workflow.edges);

    expect(payload.nodes.map((node) => node.type)).toEqual([
      'structure_generator',
      'data_generator',
      'algorithm',
      'evaluation',
      'graph_editor',
      'data_generator',
      'data_combiner',
      'algorithm',
      'evaluation',
      'evaluation_summary',
      'graph_view',
    ]);
    expect(payload.nodes.find((node) => node.id === 'seed-algo')?.data.params).toEqual({ algorithm_id: 'PC' });
    expect(payload.nodes.find((node) => node.id === 'combined-algo')?.data.params).toEqual({ algorithm_id: 'GES' });
    expect(payload.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'seed-algo', target: 'graph-adapter', sourceHandle: 'graph', targetHandle: 'graph' }),
        expect.objectContaining({ source: 'graph-adapter', target: 'residual-data', sourceHandle: 'graph', targetHandle: 'graph' }),
        expect.objectContaining({ source: 'base-data', target: 'data-combiner', sourceHandle: 'data', targetHandle: 'data' }),
        expect.objectContaining({ source: 'residual-data', target: 'data-combiner', sourceHandle: 'data', targetHandle: 'data' }),
        expect.objectContaining({ source: 'seed-eval', target: 'summary', sourceHandle: 'evaluation', targetHandle: 'evaluation' }),
        expect.objectContaining({ source: 'combined-eval', target: 'summary', sourceHandle: 'evaluation', targetHandle: 'evaluation' }),
      ]),
    );
  });

  it('materializes templates with prefixed ids and an insertion anchor', () => {
    const workflow = createWorkflowTemplate('residual_data_loop', {
      idPrefix: 'insert-1',
      origin: { x: 500, y: 600 },
      selected: true,
    });

    expect(workflow.nodes[0]).toMatchObject({
      id: 'insert-1-structure',
      selected: true,
      position: { x: 500, y: 850 },
    });
    expect(workflow.edges[0]).toMatchObject({
      id: 'insert-1-structure-base-data',
      source: 'insert-1-structure',
      target: 'insert-1-base-data',
      selected: true,
    });
  });

  it('validates connections against duplicates, cycles, disabled nodes, and IO types', () => {
    const validateConnection =
      (graphModule as Record<string, unknown>).validateConnection ??
      (runStateModule as Record<string, unknown>).preflightConnection;
    expect(validateConnection, 'v1.1 must export validateConnection or preflightConnection').toEqual(expect.any(Function));

    const nodes = [
      studioNode('structure', 'structure_generator'),
      studioNode('data', 'data_generator'),
      studioNode('algo', 'algorithm'),
      studioNode('eval', 'evaluation'),
      studioNode('view', 'graph_view'),
      studioNode('disabled', 'algorithm', true),
    ];
    const nodeTypes = [
      { id: 'structure_generator', inputs: [], outputs: ['graph'] },
      { id: 'data_generator', inputs: ['graph'], outputs: ['data'] },
      { id: 'algorithm', inputs: ['data'], outputs: ['algorithm_result'] },
      { id: 'evaluation', inputs: ['data', 'algorithm_result'], outputs: ['evaluation'] },
      { id: 'graph_view', inputs: ['graph', 'algorithm_result', 'evaluation'], outputs: ['graph_view'] },
    ];
    const edges = [
      { id: 'structure-data', source: 'structure', target: 'data' },
      { id: 'data-algo', source: 'data', target: 'algo' },
      { id: 'algo-eval', source: 'algo', target: 'eval' },
    ];
    const validate = validateConnection as (input: {
      nodes: typeof nodes;
      edges: typeof edges;
      nodeTypes: typeof nodeTypes;
      connection: { source: string | null; target: string | null };
      enforceTypeCompatibility?: boolean;
    }) => ValidationResult;

    expect(validate({ nodes, edges, nodeTypes, connection: { source: 'data', target: 'eval' } })).toMatchObject({
      valid: true,
    });

    const duplicate = validate({ nodes, edges, nodeTypes, connection: { source: 'structure', target: 'data' } });
    expect(duplicate.valid).toBe(false);
    expect(reasonOf(duplicate)).toContain('duplicate');

    const cycle = validate({ nodes, edges, nodeTypes, connection: { source: 'eval', target: 'structure' } });
    expect(cycle.valid).toBe(false);
    expect(reasonOf(cycle)).toContain('cycle');

    const incompatible = validate({
      nodes,
      edges,
      nodeTypes,
      enforceTypeCompatibility: true,
      connection: { source: 'structure', target: 'eval' },
    });
    expect(incompatible.valid).toBe(false);
    expect(['incompatible', 'type_mismatch'].some((code) => reasonOf(incompatible).includes(code))).toBe(true);

    const disabled = validate({ nodes, edges, nodeTypes, connection: { source: 'data', target: 'disabled' } });
    expect(disabled.valid).toBe(false);
    expect(reasonOf(disabled)).toContain('disabled');

    const missingEndpoint = validate({ nodes, edges, nodeTypes, connection: { source: null, target: 'data' } });
    expect(missingEndpoint.valid).toBe(false);
    expect(reasonOf(missingEndpoint)).toContain('endpoint');
  });
});
