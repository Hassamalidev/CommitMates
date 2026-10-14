// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/server/action';

const saveDetailsAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<null>>>();
vi.mock('@/server/actions/verification', () => ({ saveDetailsAction }));

const { OnboardingDetails } = await import('./OnboardingDetails');

const props = {
  universityName: 'Uni of Testland',
  departments: [{ id: 'd1', name: 'Computer Science' }],
  suggestions: ['react', 'docker', 'rust'],
  years: { min: 1966, max: 2034 },
  maxGoals: 10,
  initial: {
    role: 'student' as const,
    gradYear: null,
    department: '',
    learningGoals: ['rust'],
    visibility: 'university' as const,
    shareTodayStatus: true,
    emailDigest: true,
    timezone: 'UTC',
  },
};

afterEach(() => {
  cleanup();
  saveDetailsAction.mockReset();
});

describe('OnboardingDetails', () => {
  it('adds suggested goals and sends every field with the browser timezone', async () => {
    saveDetailsAction.mockResolvedValueOnce({ ok: true, data: null });
    render(<OnboardingDetails {...props} />);
    expect(screen.getByText('You are verified at Uni of Testland. A few details help us find you the right people.')).toBeTruthy();
    // Goals already chosen are not suggested again.
    expect(screen.queryByRole('button', { name: 'Add rust' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add react' }));
    expect(screen.getByLabelText<HTMLInputElement>('What do you want to learn?').value).toBe('rust, react');
    fireEvent.change(screen.getByLabelText('Graduation year'), { target: { value: '2027' } });
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Computer Science' } });
    fireEvent.click(screen.getByLabelText('An alumnus or alumna'));
    fireEvent.click(screen.getByLabelText('Anyone'));
    fireEvent.click(screen.getByLabelText('Email me a daily summary when something happens'));
    expect(await findA11yViolations(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => {
      expect(saveDetailsAction).toHaveBeenCalled();
    });
    const sent: FormData | undefined = saveDetailsAction.mock.calls[0]?.[1];
    expect(Object.fromEntries(sent ?? new FormData())).toMatchObject({
      role: 'alumni',
      gradYear: '2027',
      department: 'Computer Science',
      learningGoals: 'rust, react',
      visibility: 'public',
      shareTodayStatus: 'on',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(sent?.get('emailDigest')).toBeNull();
  });

  it('shows an error next to its field and keeps what was typed', async () => {
    saveDetailsAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'onboarding.unknown_goals', message: "We don't know these tags yet: zzz.", field: 'learningGoals' },
    });
    render(<OnboardingDetails {...props} />);
    fireEvent.change(screen.getByLabelText('What do you want to learn?'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => {
      expect(screen.getByLabelText('What do you want to learn?').getAttribute('aria-invalid')).toBe('true');
    });
    expect(screen.getByLabelText<HTMLInputElement>('What do you want to learn?').value).toBe('zzz');
  });
});
