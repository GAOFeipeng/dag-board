type JsonRecord = Record<string, unknown>;

const LOWER_IS_BETTER = new Set(['shd', 'bic', 'sid', 'fdr', 'fpr', 'dag_error']);

export function metricSortDirection(metric: string): 'asc' | 'desc' {
  return LOWER_IS_BETTER.has(metric.toLowerCase()) ? 'asc' : 'desc';
}

export function effectiveSortOrder(primaryMetric: string, sortOrder: unknown): 'asc' | 'desc' {
  return sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : metricSortDirection(primaryMetric);
}

export function recalculateEvaluationSummary(summary: JsonRecord, params: JsonRecord | undefined): JsonRecord {
  const primaryMetric = stringValue(params?.primary_metric) ?? stringValue(summary.primary_metric) ?? 'f1';
  const sortOrder = stringValue(params?.sort_order) ?? stringValue(summary.sort_order) ?? 'auto';
  const direction = effectiveSortOrder(primaryMetric, sortOrder);
  const rows = Array.isArray(summary.rows) ? summary.rows.filter(isRecord).map((row) => ({ ...row })) : [];

  rows.sort((left, right) => {
    const leftValue = finiteNumber(left[primaryMetric]);
    const rightValue = finiteNumber(right[primaryMetric]);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  });

  return {
    ...summary,
    rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
    primary_metric: primaryMetric,
    sort_order: sortOrder,
    effective_sort_order: direction,
    summary_meta: {
      ...(isRecord(summary.summary_meta) ? summary.summary_meta : {}),
      ranked_by: primaryMetric,
      effective_sort_order: direction,
    },
  };
}

export function transformNodeOutputForParams(output: JsonRecord | undefined, params: JsonRecord | undefined): JsonRecord | undefined {
  if (!output || !isRecord(output.evaluation_summary)) {
    return output;
  }
  return {
    ...output,
    evaluation_summary: recalculateEvaluationSummary(output.evaluation_summary, params),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
