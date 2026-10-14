// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { FypResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fypCopy } from '@/copy/fyp';

import { FypTool, parseFyp } from './FypTool';

const limits = { titleMax: 120, descriptionMin: 50, descriptionMax: 3000 };
const result: FypResult = {
  keyphrases: ['smart attendance', 'face recognition', 'edge device'],
  language: 'en',
  results: [
    { fullName: 'a/face-attendance', description: 'Attendance by face', stars: 10, similarity: 82, band: 'very-similar', sharedKeyphrases: ['smart attendance'] },
    { fullName: 'b/face-unlock', description: null, stars: 20, similarity: 45, band: 'related', sharedKeyphrases: [] },
  ],
  unique: ['edge device'],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('helpers', () => {
  it('checks results and counts characters for the description', () => {
    expect(parseFyp(result)).toBe(result);
    expect(parseFyp({ ...result, results: [{ fullName: 1 }] })).toBeNull();
    expect(fypCopy.form.descriptionHelp(10, 50, 3000)).toContain('10 / 50 characters minimum');
    expect(fypCopy.form.descriptionHelp(80, 50, 3000)).toBe('80 / 3000 characters');
  });
});

describe('FypTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('checks an idea and groups similar projects by band', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(Response.json({ status: 'done', result })));
    render(<FypTool limits={limits} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Smart attendance ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A smart attendance system using face recognition on an edge device.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check idea' }));
    await waitFor(() => {
      expect(screen.getByTestId('fyp-result')).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      '{"title":"Smart attendance","description":"A smart attendance system using face recognition on an edge device."}',
    );
    const very = screen.getByRole('heading', { name: 'Very similar' }).closest('section');
    expect(very && within(very).getByText('82% similar')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Related' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Loosely related' })).toBeNull();
    expect(screen.getByText('Shared ideas: smart attendance')).toBeTruthy();
    const different = screen.getByRole('heading', { name: 'What makes yours different' }).closest('section');
    expect(different && within(different).getByText('edge device')).toBeTruthy();
    expect(await findA11yViolations(document.body)).toEqual([]);
  });

  it('shows a description error next to the field', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(Response.json({ status: 'error', error: { code: 'tool.invalid_input', message: 'Describe the idea in at least 50 characters.', field: 'description' } }, { status: 400 })),
    );
    render(<FypTool limits={limits} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check idea' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Description').getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('says so when nothing similar was found', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(Response.json({ status: 'done', result: { ...result, results: [], unique: [] } })));
    render(<FypTool limits={limits} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check idea' }));
    await waitFor(() => {
      expect(screen.getByText(fypCopy.result.none)).toBeTruthy();
    });
    expect(screen.getByText(fypCopy.result.differentNone)).toBeTruthy();
  });
});
