import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { TemplateMenu, type WorkflowTemplateMenuItem } from './TemplateMenu';

const templates: WorkflowTemplateMenuItem[] = [
  {
    id: 'baseline_compare',
    label: 'Baseline comparison',
    description: 'Compare official baselines.',
  },
  {
    id: 'residual_data_loop',
    label: 'Residual data loop',
    description: 'Build residual-style data experiments.',
  },
  {
    id: 'algorithm_sweep',
    label: 'Algorithm sweep',
    description: 'Run several baselines and export a report.',
  },
  {
    id: 'data_fusion_ablation',
    label: 'Data fusion ablation',
    description: 'Compare source-only and fused-data baselines.',
  },
];

describe('TemplateMenu', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('opens templates and reports the selected insert action', async () => {
    const user = userEvent.setup();
    const onInsertTemplate = vi.fn();
    const onReplaceTemplate = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <TemplateMenu templates={templates} onInsertTemplate={onInsertTemplate} onReplaceTemplate={onReplaceTemplate} />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /templates/i }));

    expect(screen.getByRole('menu', { name: 'Start from template' })).toBeInTheDocument();

    expect(screen.getAllByRole('menuitem')).toHaveLength(8);

    await user.click(screen.getByRole('menuitem', { name: /insert data fusion ablation/i }));

    expect(onInsertTemplate).toHaveBeenCalledWith('data_fusion_ablation');
    expect(onReplaceTemplate).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reports the selected replacement action', async () => {
    const user = userEvent.setup();
    const onInsertTemplate = vi.fn();
    const onReplaceTemplate = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <TemplateMenu templates={templates} onInsertTemplate={onInsertTemplate} onReplaceTemplate={onReplaceTemplate} />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /templates/i }));
    await user.click(screen.getByRole('menuitem', { name: /replace algorithm sweep/i }));

    expect(onReplaceTemplate).toHaveBeenCalledWith('algorithm_sweep');
    expect(onInsertTemplate).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
