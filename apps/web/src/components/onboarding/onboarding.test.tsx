// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionResult } from '@/server/action';
import type { StartResult } from '@/server/actions/verification';

type StartAction = (previous: unknown, formData: FormData) => Promise<ActionResult<StartResult>>;
const startVerificationAction = vi.fn<StartAction>();
const confirmCodeAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<null>>>();
vi.mock('@/server/actions/verification', () => ({ startVerificationAction, confirmCodeAction }));

const { VerifyEmail } = await import('./VerifyEmail');

afterEach(() => {
  cleanup();
  startVerificationAction.mockReset();
  confirmCodeAction.mockReset();
});

const submitEmail = (email: string) => {
  fireEvent.change(screen.getByLabelText('University email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
};

describe('VerifyEmail', () => {
  it('asks which university when several share the domain, then moves to the code', async () => {
    startVerificationAction.mockResolvedValueOnce({
      ok: true,
      data: { status: 'choose', universities: [{ id: 'a', name: 'Campus One' }, { id: 'b', name: 'Campus Two' }] },
    });
    render(<VerifyEmail pending={null} />);
    submitEmail('ada@shared.edu');
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /Several universities use this email domain/ })).toBeTruthy();
    });
    expect(screen.getByLabelText<HTMLInputElement>('Campus One').checked).toBe(true);
    expect(await findA11yViolations(document.body)).toEqual([]);

    startVerificationAction.mockResolvedValueOnce({ ok: true, data: { status: 'sent', universityName: 'Campus Two' } });
    fireEvent.click(screen.getByLabelText('Campus Two'));
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => {
      expect(screen.getByText('We sent a 6-digit code for Campus Two. It can take a minute to arrive.')).toBeTruthy();
    });
    const sent: FormData | undefined = startVerificationAction.mock.calls[1]?.[1];
    expect(sent?.get('universityId')).toBe('b');
    expect(sent?.get('email')).toBe('ada@shared.edu');
  });

  it('explains an unknown domain and keeps the email step', async () => {
    startVerificationAction.mockResolvedValueOnce({ ok: true, data: { status: 'unknown', domain: 'nowhere.edu' } });
    render(<VerifyEmail pending={null} />);
    submitEmail('ada@nowhere.edu');
    await waitFor(() => {
      expect(screen.getByText(/We don't recognize nowhere\.edu as a university domain yet/)).toBeTruthy();
    });
    expect(screen.getByLabelText('University email')).toBeTruthy();
  });

  it('shows an email error inline', async () => {
    startVerificationAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'verify.disposable', message: 'Throwaway email addresses cannot verify a university.', field: 'email' },
    });
    render(<VerifyEmail pending={null} />);
    submitEmail('ada@mailinator.com');
    await waitFor(() => {
      expect(screen.getByLabelText('University email').getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('resumes at the code step, and can switch to another email', () => {
    render(<VerifyEmail pending={{ email: 'ada@uni.edu', universityName: 'Uni' }} />);
    expect(screen.getByText('Your code for Uni is on its way or already in your inbox.')).toBeTruthy();
    expect(screen.getByLabelText('Verification code')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText<HTMLInputElement>('University email').value).toBe('ada@uni.edu');
  });
});
