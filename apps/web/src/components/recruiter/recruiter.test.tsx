// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleRecruiter } from '@/__fixtures__/recruiter';

const loadOwnSecretScan = vi.fn();
vi.mock('@/server/actions/recruiter', () => ({ loadOwnSecretScan }));

const { parseSkills, recruiterCopy, secretRuleName } = await import('@/copy/recruiter');
const { parseRecruiter } = await import('@/lib/recruiter');
const { RecruiterTool } = await import('./RecruiterTool');
const { RecruiterView } = await import('./RecruiterView');
const { SecretPanel } = await import('./SecretPanel');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('copy helpers', () => {
  it('splits pasted skills on commas and lines, without duplicates', () => {
    expect(parseSkills('React, TypeScript\nGo,, react ,React')).toEqual(['React', 'TypeScript', 'Go', 'react']);
    expect(parseSkills('  ')).toEqual([]);
  });

  it('turns rule ids into words', () => {
    expect(secretRuleName('github-pat')).toBe('github pat');
    expect(secretRuleName('aws_access-token')).toBe('aws access token');
  });

  it('writes evidence from the numbers, for every rule', () => {
    const { rules } = recruiterCopy;
    expect(rules.profileReadme.evidence({ chars: null, min: 200 })).toContain('There is no profile README');
    expect(rules.profileReadme.evidence({ chars: 120, min: 200 })).toBe('The profile README has 120 characters; aim for at least 200.');
    expect(rules.pinnedReadme.evidence({ met: 1, total: 3, min: 600, source: 'top' })).toBe(
      '1 of 3 top repositories have a README over 600 characters.',
    );
    expect(rules.languageMatch.evidence({ matched: 1, total: 3, missing: ['go', 'rust'] })).toBe(
      '1 of 3 skills you listed show up in the code. Not found: go, rust.',
    );
    expect(rules.activityConsistency.evidence({ activeDayShare: 0.25, target: 0.5 })).toBe('Active on 25% of the last 90 days (aim for 50%).');
  });
});

describe('parseRecruiter', () => {
  it('accepts a stored report and rejects other shapes', () => {
    expect(parseRecruiter(sampleRecruiter)).toBe(sampleRecruiter);
    for (const bad of [null, {}, { ...sampleRecruiter, rules: null }, { ...sampleRecruiter, score: '64' }, { ...sampleRecruiter, rules: [{ key: 1 }] }, { ...sampleRecruiter, secretScanRan: 'no' }]) {
      expect(parseRecruiter(bad)).toBeNull();
    }
  });
});

describe('RecruiterView', () => {
  it('shows the score and every checked rule with its evidence, and a fix where it falls short', () => {
    render(<RecruiterView result={sampleRecruiter} />);
    const report = screen.getByRole('article', { name: "@fixture-user-1 through a recruiter's eyes" });
    expect(within(report).getByRole('meter', { name: 'Recruiter-Ready score' }).getAttribute('aria-valuenow')).toBe('64');
    const items = within(report).getAllByRole('listitem');
    expect(items).toHaveLength(10);
    expect(within(report).getByText('1 of 2 pinned repositories have a README over 600 characters.')).toBeTruthy();
    expect(within(report).getAllByText('How to fix').length).toBe(7);
    expect(within(report).getByText('Not checked this time: Skills you listed.')).toBeTruthy();
    expect(within(report).getAllByRole('img', { name: 'Passed' })).toHaveLength(3);
  });

  it('says when the top repositories stood in for pinned ones, and when nothing could be scored', () => {
    render(<RecruiterView result={{ ...sampleRecruiter, usedTopRepos: true, score: null }} />);
    expect(screen.getByText(recruiterCopy.result.usedTop)).toBeTruthy();
    expect(screen.getByText(recruiterCopy.result.noScore)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(<RecruiterView result={sampleRecruiter} />);
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('SecretPanel', () => {
  it('lists where keys are, with the fix', async () => {
    const load = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { findings: [{ ruleId: 'github-pat', repo: 'me/app', path: 'src/client.ts', line: 4 }], partial: true, filesScanned: 200, computedAt: '2026-10-14T12:00:00.000Z' },
      }),
    );
    render(<SecretPanel load={load} />);
    expect(screen.getByText(recruiterCopy.secrets.loading)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('github pat in me/app/src/client.ts, line 4')).toBeTruthy();
    });
    expect(screen.getByText(recruiterCopy.secrets.fix)).toBeTruthy();
    expect(screen.getByText(recruiterCopy.secrets.partial(200))).toBeTruthy();
  });

  it('reports a clean scan and a failed load', async () => {
    const { unmount } = render(
      <SecretPanel load={() => Promise.resolve({ ok: true, data: { findings: [], partial: false, filesScanned: 1, computedAt: 'x' } })} />,
    );
    await waitFor(() => {
      expect(screen.getByText('No leaked keys found in 1 file.')).toBeTruthy();
    });
    unmount();
    render(<SecretPanel load={() => Promise.resolve({ ok: false, error: { message: 'no' } })} />);
    await waitFor(() => {
      expect(screen.getByText(recruiterCopy.secrets.failed)).toBeTruthy();
    });
  });
});

describe('RecruiterTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
  const sentBody = (call = 0) => {
    const body = fetchMock.mock.calls[call]?.[1]?.body;
    return (typeof body === 'string' ? JSON.parse(body) : null) as Record<string, unknown> | null;
  };

  beforeEach(() => {
    fetchMock.mockReset();
    loadOwnSecretScan.mockReset();
    loadOwnSecretScan.mockResolvedValue({ ok: true, data: { findings: [], partial: false, filesScanned: 3, computedAt: 'x' } });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/tools/recruiter');
  });

  it('offers the secret scan only for the member’s own account and asks for it by default', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { ...sampleRecruiter, secretScanRan: true } }));
    render(<RecruiterTool memberLogin="Fixture-User-1" />);
    expect(screen.getByLabelText<HTMLInputElement>('GitHub username').value).toBe('Fixture-User-1');
    const scan = screen.getByRole('checkbox', { name: /Also scan my repositories/ });
    expect((scan as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText('Skills on your CV (optional)'), { target: { value: 'React, Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check profile' }));
    await waitFor(() => {
      expect(screen.getByTestId('secret-panel')).toBeTruthy();
    });
    expect(sentBody()).toEqual({ login: 'Fixture-User-1', resumeSkills: ['React', 'Go'], scanSecrets: true });
    expect(loadOwnSecretScan).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: 'someone-else' } });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('never asks for a scan of someone else and never shows a panel for them', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { ...sampleRecruiter, login: 'someone-else', secretScanRan: true } }));
    render(<RecruiterTool initialLogin="someone-else" memberLogin="fixture-user-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('recruiter-result')).toBeTruthy();
    });
    expect(sentBody()).toEqual({ login: 'someone-else' });
    expect(screen.queryByTestId('secret-panel')).toBeNull();
    expect(loadOwnSecretScan).not.toHaveBeenCalled();
  });

  it('lets the owner skip the scan', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleRecruiter }));
    render(<RecruiterTool memberLogin="fixture-user-1" />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Also scan my repositories/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Check profile' }));
    await waitFor(() => {
      expect(screen.getByTestId('recruiter-result')).toBeTruthy();
    });
    expect(sentBody()).toEqual({ login: 'fixture-user-1' });
  });

  it('puts a skills error next to the skills field', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'error', error: { code: 'tool.invalid_input', message: 'Up to 30 skills.', field: 'resumeSkills' } }, 400));
    render(<RecruiterTool />);
    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: 'someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check profile' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Skills on your CV (optional)').getAttribute('aria-invalid')).toBe('true');
    });
  });
});
