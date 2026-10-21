// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  ossCampusAction: vi.fn(),
  askOssContributorAction: vi.fn(() => Promise.resolve({ ok: true as const, data: null })),
}));
vi.mock('@/server/actions/oss', () => actions);

const { OssCampusLine, useOssCampus } = await import('./OssCampus');

function Probe({ repos, signedIn }: { repos: string[]; signedIn: boolean }) {
  const contributors = useOssCampus(repos, signedIn);
  return <p>{contributors ? Object.keys(contributors).join(',') : 'none'}</p>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useOssCampus', () => {
  it('asks once per set of projects for signed-in members, and never for visitors', async () => {
    actions.ossCampusAction.mockResolvedValue({ ok: true, data: { state: 'open', contributors: { 'a/b': [], 'c/d': [] } } });
    render(<Probe repos={['a/b', 'c/d']} signedIn={false} />);
    expect(screen.getByText('none')).toBeTruthy();
    expect(actions.ossCampusAction).not.toHaveBeenCalled();
    cleanup();
    render(<Probe repos={['a/b', 'c/d']} signedIn />);
    expect(await screen.findByText('a/b,c/d')).toBeTruthy();
    expect(actions.ossCampusAction).toHaveBeenCalledWith(['a/b', 'c/d']);
  });
});

describe('OssCampusLine', () => {
  it('shows nothing without contributors', () => {
    const { container } = render(<OssCampusLine repo="a/b" people={[]} />);
    expect(container.textContent).toBe('');
  });

  it('lists contributors with their merged pull requests and sends a prefilled request', async () => {
    const { container } = render(
      <OssCampusLine
        repo="vercel/next.js"
        people={[
          { userId: 'u1', login: 'kim', mergedPrs: 3 },
          { userId: 'u2', login: 'sam', mergedPrs: 1 },
        ]}
      />,
    );
    expect(screen.getByText('2 members of your university contributed here.')).toBeTruthy();
    expect(screen.getByText('@sam · 1 merged pull request')).toBeTruthy();
    expect(await findA11yViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask @kim' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask @kim about this project' });
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Message').value).toContain('merged into vercel/next.js');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByText('Request sent to @kim.')).toBeTruthy();
    });
    const form = actions.askOssContributorAction.mock.calls[0] as unknown as [unknown, FormData];
    expect([form[1].get('toUserId'), form[1].get('repo')]).toEqual(['u1', 'vercel/next.js']);
  });
});
