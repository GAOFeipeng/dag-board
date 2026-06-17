import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunPanel } from './RunPanel';

describe('RunPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('lets failed run events focus their node from logs', async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();

    render(
      <RunPanel
        events={[
          {
            index: 1,
            event: 'node_failed',
            level: 'error',
            node_id: 'algorithm-1',
            message: 'Official baseline failed.',
            payload: {},
          },
        ]}
        runStatus="failed"
        nodeOutputs={{}}
        selectedNodeId={null}
        onSelectNode={onSelectNode}
      />,
    );

    expect(screen.getByText('Official baseline failed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'algorithm-1' }));
    expect(onSelectNode).toHaveBeenCalledWith('algorithm-1');

    await user.click(screen.getByRole('button', { name: /latest issue/i }));
    expect(onSelectNode).toHaveBeenCalledWith('algorithm-1');
  });
});
