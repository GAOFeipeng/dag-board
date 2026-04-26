import { describe, expect, it } from 'vitest';
import { recalculateEvaluationSummary } from './outputTransforms';

describe('output transforms', () => {
  it('reranks evaluation summaries with automatic metric direction', () => {
    const summary = {
      primary_metric: 'f1',
      sort_order: 'auto',
      rows: [
        { label: 'A', f1: 0.5, shd: 8 },
        { label: 'B', f1: 0.8, shd: 3 },
      ],
    };

    expect(recalculateEvaluationSummary(summary, { primary_metric: 'f1', sort_order: 'auto' }).rows).toMatchObject([
      { label: 'B', rank: 1 },
      { label: 'A', rank: 2 },
    ]);
    expect(recalculateEvaluationSummary(summary, { primary_metric: 'shd', sort_order: 'auto' }).rows).toMatchObject([
      { label: 'B', rank: 1 },
      { label: 'A', rank: 2 },
    ]);
  });
});
