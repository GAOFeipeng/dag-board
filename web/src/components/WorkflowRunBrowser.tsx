import { Clock3, FileText, FolderOpen, RefreshCw } from 'lucide-react';

type JsonRecord = Record<string, unknown>;

export type WorkflowRunBrowserWorkflow = JsonRecord & {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkflowRunBrowserRun = JsonRecord & {
  id?: string | null;
  run_id?: string | null;
  workflow_id?: string | null;
  workflow_name?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkflowRunBrowserProps = {
  workflows?: readonly WorkflowRunBrowserWorkflow[] | null;
  runs?: readonly WorkflowRunBrowserRun[] | null;
  selectedWorkflowId?: string | null;
  selectedRunId?: string | null;
  workflowFilter?: string;
  runFilter?: string;
  isLoadingWorkflows?: boolean;
  isLoadingRuns?: boolean;
  disabled?: boolean;
  onWorkflowFilterChange?: (value: string) => void;
  onRunFilterChange?: (value: string) => void;
  onRefreshWorkflows?: () => void;
  onRefreshRuns?: () => void;
  onLoadWorkflow?: (workflowId: string, workflow: WorkflowRunBrowserWorkflow) => void;
  onOpenRun?: (runId: string, run: WorkflowRunBrowserRun) => void;
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function workflowId(workflow: WorkflowRunBrowserWorkflow): string {
  return firstString(workflow, ['id', 'workflow_id', 'workflowId']);
}

function workflowName(workflow: WorkflowRunBrowserWorkflow): string {
  return firstString(workflow, ['name', 'workflow_name', 'workflowName']) || workflowId(workflow) || 'Untitled workflow';
}

function runId(run: WorkflowRunBrowserRun): string {
  return firstString(run, ['run_id', 'runId', 'id']);
}

function runName(run: WorkflowRunBrowserRun): string {
  return firstString(run, ['workflow_name', 'workflowName', 'name']) || runId(run) || 'Run';
}

function compactDate(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function searchableText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(searchableText).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value as JsonRecord)
      .map(([key, item]) => `${key} ${searchableText(item)}`)
      .join(' ');
  }
  return String(value);
}

function matchesFilter(value: unknown, filter: string | undefined): boolean {
  const normalized = (filter ?? '').trim().toLowerCase();
  return !normalized || searchableText(value).toLowerCase().includes(normalized);
}

function statusTone(status: unknown): string {
  if (status === 'completed' || status === 'success') return '#48c78e';
  if (status === 'failed') return '#ff6b6b';
  if (status === 'running' || status === 'queued') return '#f7c948';
  return '#8bd5ff';
}

function FilterInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 5, color: '#c8d1d5', fontSize: 12 }}>
      <span>{label}</span>
      <input
        value={value}
        readOnly={!onChange}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="Filter"
        style={{
          width: '100%',
          minHeight: 30,
          border: '1px solid #384148',
          borderRadius: 6,
          background: '#111416',
          color: '#edf2f4',
          padding: '0 8px',
        }}
      />
    </label>
  );
}

function EmptyRow({ children }: { children: string }) {
  return <div className="empty-state compact">{children}</div>;
}

export function WorkflowRunBrowser({
  workflows = [],
  runs = [],
  selectedWorkflowId = null,
  selectedRunId = null,
  workflowFilter = '',
  runFilter = '',
  isLoadingWorkflows = false,
  isLoadingRuns = false,
  disabled = false,
  onWorkflowFilterChange,
  onRunFilterChange,
  onRefreshWorkflows,
  onRefreshRuns,
  onLoadWorkflow,
  onOpenRun,
}: WorkflowRunBrowserProps) {
  const visibleWorkflows = (workflows ?? []).filter((workflow) => matchesFilter(workflow, workflowFilter));
  const visibleRuns = (runs ?? []).filter((run) => matchesFilter(run, runFilter));

  return (
    <section style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <div className="panel-heading small">
          <FileText size={15} />
          <span>Workflows</span>
          <strong>{isLoadingWorkflows ? 'loading' : visibleWorkflows.length}</strong>
          {onRefreshWorkflows ? (
            <button type="button" onClick={onRefreshWorkflows} disabled={disabled || isLoadingWorkflows} title="Refresh workflows" style={{ minHeight: 26, padding: '0 7px' }}>
              <RefreshCw size={13} className={isLoadingWorkflows ? 'spin' : undefined} />
            </button>
          ) : null}
        </div>
        <FilterInput label="Workflow filter" value={workflowFilter} onChange={onWorkflowFilterChange} disabled={disabled} />
        <div className="event-log">
          {visibleWorkflows.map((workflow) => {
            const id = workflowId(workflow);
            const selected = Boolean(id && id === selectedWorkflowId);
            return (
              <button
                key={id || workflowName(workflow)}
                type="button"
                className="event"
                disabled={disabled || !id || !onLoadWorkflow}
                onClick={() => id && onLoadWorkflow?.(id, workflow)}
                title={id || workflowName(workflow)}
                style={{
                  width: '100%',
                  borderColor: selected ? '#80c7f4' : undefined,
                  background: selected ? '#25313a' : undefined,
                }}
              >
                <span>{workflowName(workflow)}</span>
                <code>{compactDate(workflow.updated_at ?? workflow.created_at) || id}</code>
              </button>
            );
          })}
          {!visibleWorkflows.length ? <EmptyRow>{isLoadingWorkflows ? 'Loading workflows.' : 'No matching workflows.'}</EmptyRow> : null}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <div className="panel-heading small">
          <FolderOpen size={15} />
          <span>Runs</span>
          <strong>{isLoadingRuns ? 'loading' : visibleRuns.length}</strong>
          {onRefreshRuns ? (
            <button type="button" onClick={onRefreshRuns} disabled={disabled || isLoadingRuns} title="Refresh runs" style={{ minHeight: 26, padding: '0 7px' }}>
              <RefreshCw size={13} className={isLoadingRuns ? 'spin' : undefined} />
            </button>
          ) : null}
        </div>
        <FilterInput label="Run filter" value={runFilter} onChange={onRunFilterChange} disabled={disabled} />
        <div className="event-log">
          {visibleRuns.map((run) => {
            const id = runId(run);
            const status = stringValue(run.status) || 'unknown';
            const selected = Boolean(id && id === selectedRunId);
            return (
              <button
                key={id || runName(run)}
                type="button"
                className="event"
                disabled={disabled || !id || !onOpenRun}
                onClick={() => id && onOpenRun?.(id, run)}
                title={id || runName(run)}
                style={{
                  width: '100%',
                  borderColor: selected ? '#80c7f4' : undefined,
                  background: selected ? '#25313a' : undefined,
                }}
              >
                <span>{runName(run)}</span>
                <code style={{ color: statusTone(status) }}>
                  <Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  {status}
                </code>
                <code style={{ gridColumn: '1 / -1' }}>{compactDate(run.finished_at ?? run.started_at ?? run.updated_at ?? run.created_at) || id}</code>
              </button>
            );
          })}
          {!visibleRuns.length ? <EmptyRow>{isLoadingRuns ? 'Loading runs.' : 'No matching runs.'}</EmptyRow> : null}
        </div>
      </div>
    </section>
  );
}
