import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithTheme } from '../testUtils';
import { useToast } from './ToastProvider';

function Buttons({ onSettings }: { onSettings: () => void }) {
  const showToast = useToast();
  return (
    <>
      <button
        onClick={() =>
          showToast({
            message: 'Allow notifications',
            severity: 'error',
            action: { label: 'Settings', onClick: onSettings },
          })
        }
      >
        with action
      </button>
      <button onClick={() => showToast({ message: 'Command failed', severity: 'error' })}>plain</button>
    </>
  );
}

describe('ToastProvider', () => {
  afterEach(cleanup);

  it('runs a toast action', async () => {
    const onSettings = vi.fn();
    renderWithTheme(<Buttons onSettings={onSettings} />);

    await userEvent.click(screen.getByRole('button', { name: 'with action' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('does not carry an action over to the next message', async () => {
    renderWithTheme(<Buttons onSettings={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'with action' }));
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'plain' }));
    expect(await screen.findByText('Command failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
