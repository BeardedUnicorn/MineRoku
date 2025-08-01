import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithTheme } from '../testUtils';
import RemotePopup from './RemotePopup';
import { screen, act } from '@testing-library/react';
import { listen, emit } from '@tauri-apps/api/event';

vi.mock('./RemoteControl', () => ({ default: () => <div>Mock Remote</div> }));

const listeners: Record<string, (event: any) => void> = {};
vi.mocked(listen).mockImplementation((event, cb) => {
  listeners[event] = cb as any;
  return Promise.resolve(() => {});
});

describe('RemotePopup', () => {
  it('renders remote when device selected via event', async () => {
    renderWithTheme(<RemotePopup />);

    expect(screen.getByText(/no device selected/i)).toBeInTheDocument();
    expect(emit).toHaveBeenCalledWith('popup-ready');

    await act(async () => {
      listeners['device-changed']?.({ payload: { name: 'TV', ip: '0.0.0.0', port: 8060, url: '', status: 'connected' } });
    });

    expect(screen.getByText('Mock Remote')).toBeInTheDocument();
  });
});
