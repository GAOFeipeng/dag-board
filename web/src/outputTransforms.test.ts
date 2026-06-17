import { describe, expect, it } from 'vitest';
import { recalculateEvaluationSummary } from './outputTransforms';

describe('output transforms', () => {
  it('reranks evaluation summaries with automatic metric direction', () => {
    const summary = {
      primary_metric: 'f1',
      sort_order: 'auto',
      rows: [
        { label: 'A', algorithm: 'DAGMA', input_data: 'Data #1', f1: 0.5, shd: 8 },
        { label: 'B', algorithm: 'PC', input_data: 'Data #2', f1: 0.8, shd: 3 },
      ],
    };

    expect(recalculateEvaluationSummary(summary, { primary_metric: 'f1', sort_order: 'auto' }).rows).toMatchObject([
      { label: 'B', algorithm: 'PC', input_data: 'Data #2', rank: 1 },
      { label: 'A', algorithm: 'DAGMA', input_data: 'Data #1', rank: 2 },
    ]);
    expect(recalculateEvaluationSummary(summary, { primary_metric: 'shd', sort_order: 'auto' }).rows).toMatchObject([
      { label: 'B', rank: 1 },
      { label: 'A', rank: 2 },
    ]);
  });
});
