import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import BottomNavBar from './BottomNavBar';
import { renderWithTheme } from '../testUtils';

describe('BottomNavBar', () => {
  it('calls setView when navigation option selected', async () => {
    const setView = vi.fn();
    renderWithTheme(<BottomNavBar view="remote" setView={setView} />);

    await userEvent.click(screen.getByRole('button', { name: /apps/i }));
    expect(setView).toHaveBeenCalledWith('apps');
  });
});
