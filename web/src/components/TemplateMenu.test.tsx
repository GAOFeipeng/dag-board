import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
];

describe('TemplateMenu', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('opens templates and reports the selected replacement', async () => {
    const user = userEvent.setup();
    const onReplaceTemplate = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <TemplateMenu templates={templates} onReplaceTemplate={onReplaceTemplate} />
      </I18nextProvider>,
    );

    await user.click(screen.getByRole('button', { name: /templates/i }));

    expect(screen.getByRole('menu', { name: 'Start from template' })).toBeInTheDocument();

    expect(screen.getAllByRole('menuitem')).toHaveLength(3);

    await user.click(screen.getByRole('menuitem', { name: /algorithm sweep/i }));

    expect(onReplaceTemplate).toHaveBeenCalledWith('algorithm_sweep');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
