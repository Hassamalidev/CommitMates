// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { OssResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ossCopy } from '@/copy/oss';

import { OssTool, parseOss, splitList } from './OssTool';

const result: OssResult = {
  languages: ['TypeScript'],
  topics: ['react'],
  relaxed: ['comments'],
  issues: [
    {
      repo: 'fast/web',
      number: 1,
      title: 'Add a dark mode toggle',
      url: 'https://github.com/fast/web/issues/1',
      labels: ['good first issue'],
      comments: 0,
      ageDays: 2,
      responseHours: 5,
      skillMatch: 0.5,
      rank: 0.8,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('helpers', () => {
  it('splits lists and checks results', () => {
    expect(splitList(' TypeScript, ,Go,TypeScript ')).toEqual(['TypeScript', 'Go']);
    expect(parseOss(result)).toBe(result);
    expect(parseOss({ ...result, issues: [{ url: 1 }] })).toBeNull();
    expect(parseOss(null)).toBeNull();
  });

  it('describes reply times in hours or days', () => {
    expect(ossCopy.result.reply(5.4)).toBe('Maintainers usually reply in about 5 hours');
    expect(ossCopy.result.reply(0.2)).toBe('Maintainers usually reply in about 1 hours');
    expect(ossCopy.result.reply(72)).toBe('Maintainers usually reply in about 3 days');
  });
});

describe('OssTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('searches by picked languages and topics, and shows issues with their chips', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(Response.json({ status: 'done', result })));
    render(<OssTool languageOptions={['TypeScript', 'Go']} />);
    fireEvent.change(screen.getByLabelText('Or pick languages'), { target: { value: 'TypeScript, Go' } });
    fireEvent.change(screen.getByLabelText('Topics you like (optional)'), { target: { value: 'react' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find issues' }));
    await waitFor(() => {
      expect(screen.getByTestId('oss-result')).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"languages":["TypeScript","Go"],"topics":["react"]}');
    const card = screen.getByRole('article', { name: 'Add a dark mode toggle' });
    expect(within(card).getByText('Maintainers usually reply in about 5 hours')).toBeTruthy();
    expect(within(card).getByText('50% skill match')).toBeTruthy();
    expect(within(card).getByText('good first issue')).toBeTruthy();
    expect(screen.getByText(ossCopy.result.relaxed.comments)).toBeTruthy();
    expect(await findA11yViolations(document.body)).toEqual([]);
  });

  it('starts at once for a username and explains when nothing matched', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(Response.json({ status: 'done', result: { ...result, issues: [], relaxed: [] } })));
    render(<OssTool initialLogin="someone" languageOptions={[]} />);
    await waitFor(() => {
      expect(screen.getByText(ossCopy.result.none)).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"login":"someone"}');
  });
});
