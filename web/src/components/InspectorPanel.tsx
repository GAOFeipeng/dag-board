import { useState } from 'react';
import { Plus, SlidersHorizontal, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AlgorithmRow, NodeField, NodeTypeDefinition, StudioNode } from '../types';

function parseJson(raw: string, fallback: unknown) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function FieldEditor({
  field,
  value,
  algorithms,
  onChange,
}: {
  field: NodeField;
  value: unknown;
  algorithms: AlgorithmRow[];
  onChange: (value: unknown) => void;
}) {
  if (field.name === 'algorithm_id') {
    return (
      <select value={String(value ?? field.default ?? '')} onChange={(event) => onChange(event.target.value)}>
        {algorithms.map((algorithm) => (
          <option key={algorithm.name} value={algorithm.name}>
            {algorithm.name} - {algorithm.provider}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'select') {
    return (
      <select value={String(value ?? field.default ?? '')} onChange={(event) => onChange(event.target.value)}>
        {field.default === null || field.default === undefined ? <option value="">{field.placeholder || 'official default'}</option> : null}
        {field.options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (field.kind === 'integer' || field.kind === 'number') {
    return (
      <input
        type="number"
        step={field.kind === 'integer' ? 1 : 0.01}
        value={value === null || value === undefined || value === '' ? '' : Number(value)}
        placeholder={field.placeholder}
        onChange={(event) => {
          if (event.target.value === '') {
            onChange(null);
            return;
          }
          const parsed = field.kind === 'integer' ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
    );
  }
  if (field.kind === 'json') {
    const textValue =
      value === null || value === undefined || value === ''
        ? ''
        : JSON.stringify(value ?? field.default ?? {}, null, 2);
    return (
      <textarea
        rows={4}
        value={textValue}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value.trim() ? parseJson(event.target.value, value ?? field.default) : null)}
      />
    );
  }
  return <input value={String(value ?? '')} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
}

export function InspectorPanel({
  selectedNode,
  selectionSummary,
  nodeTypes,
  algorithms,
  onUpdate,
  onRename,
  onUploadImport,
}: {
  selectedNode: StudioNode | null;
  selectionSummary?: { nodeCount: number; edgeCount: number };
  nodeTypes: NodeTypeDefinition[];
  algorithms: AlgorithmRow[];
  onUpdate: (nodeId: string, params: Record<string, unknown>) => void;
  onRename?: (nodeId: string, label: string) => void;
  onUploadImport?: (nodeId: string, file: File) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [uploadingNodeId, setUploadingNodeId] = useState<string | null>(null);
  const definition = selectedNode ? nodeTypes.find((item) => item.id === selectedNode.data.nodeType) : null;
  const params = selectedNode?.data.params ?? {};
  const editRows = Array.isArray(params.edits) ? params.edits : [];

  return (
    <aside className="right-panel">
      <div className="panel-heading">
        <SlidersHorizontal size={16} />
        <span>{t('panels.inspector')}</span>
      </div>
      {selectionSummary && selectionSummary.nodeCount > 1 ? (
        <div className="empty-state">
          <p>{t('panels.multiSelect', selectionSummary)}</p>
          <p>{t('panels.multiSelectHint')}</p>
        </div>
      ) : !selectedNode || !definition ? (
        <div className="empty-state">{t('panels.selectNode')}</div>
      ) : (
        <div className="inspector-body">
          <label className="field-row">
            <span>{t('panels.nodeName')}</span>
            <input
              value={selectedNode.data.label}
              onChange={(event) => onRename?.(selectedNode.id, event.target.value)}
            />
          </label>
          <p>{definition.description}</p>
          {selectedNode.data.nodeType === 'data_import' ? (
            <label className="field-row">
              <span>Upload</span>
              <span className="file-upload-row">
                <Upload size={14} />
                <input
                  type="file"
                  accept=".csv,.npy,.npz"
                  disabled={!onUploadImport || uploadingNodeId === selectedNode.id}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file || !onUploadImport) return;
                    setUploadingNodeId(selectedNode.id);
                    void onUploadImport(selectedNode.id, file).finally(() => {
                      setUploadingNodeId(null);
                      event.currentTarget.value = '';
                    });
                  }}
                />
              </span>
            </label>
          ) : null}
          {definition.fields.map((field) => (
            <label key={field.name} className="field-row">
              <span>{field.label}</span>
              <FieldEditor
                field={field}
                value={params[field.name]}
                algorithms={algorithms}
                onChange={(value) => onUpdate(selectedNode.id, { ...params, [field.name]: value })}
              />
            </label>
          ))}
          {selectedNode.data.nodeType === 'graph_editor' ? (
            <div className="inspector-actions">
              <button
                type="button"
                onClick={() => onUpdate(selectedNode.id, { ...params, edits: [...editRows, { op: 'set_edge', source: 'X1', target: 'X2', weight: 1 }] })}
              >
                <Plus size={13} />
                Set edge
              </button>
              <button
                type="button"
                onClick={() => onUpdate(selectedNode.id, { ...params, edits: [...editRows, { op: 'remove_edge', source: 'X1', target: 'X2' }] })}
              >
                <Plus size={13} />
                Remove edge
              </button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
