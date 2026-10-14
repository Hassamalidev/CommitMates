// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleCompat } from '@/__fixtures__/compat';
import { compatCopy } from '@/copy/compat';
import { localHourRange, parseCompat } from '@/lib/compat';

import { CompatTool } from './CompatTool';
import { CompatView } from './CompatView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('parseCompat', () => {
  it('accepts a stored comparison and rejects other shapes', () => {
    expect(parseCompat(sampleCompat)).toBe(sampleCompat);
    expect(parseCompat({ ...sampleCompat, score: null })).not.toBeNull();
    for (const bad of [
      null,
      {},
      { ...sampleCompat, a: { login: 'x' } },
      { ...sampleCompat, b: null },
      { ...sampleCompat, score: '72' },
      { ...sampleCompat, components: null },
    ]) {
      expect(parseCompat(bad)).toBeNull();
    }
  });
});

describe('localHourRange', () => {
  const on = new Date('2026-10-14T00:00:00Z');

  it("converts UTC hours to the viewer's clock", () => {
    expect(localHourRange({ startHourUtc: 21, hours: 2 }, 'UTC', on)).toEqual(['21:00', '23:00']);
    // +05:00 crosses midnight.
    expect(localHourRange({ startHourUtc: 21, hours: 2 }, 'Asia/Karachi', on)).toEqual(['02:00', '04:00']);
    expect(localHourRange({ startHourUtc: 23, hours: 3 }, 'UTC', on)).toEqual(['23:00', '02:00']);
    expect(localHourRange({ startHourUtc: 14, hours: 2 }, 'America/New_York', on)).toEqual(['10:00', '12:00']);
  });
});

describe('CompatView', () => {
  it('shows both companions facing each other, the score, the band and the breakdown', () => {
    render(<CompatView result={sampleCompat} />);
    const result = screen.getByRole('article', { name: '@alice-dev and @bob-dev' });
    expect(within(result).getByRole('img', { name: 'The companion of @alice-dev' })).toBeTruthy();
    const second = within(result).getByRole('img', { name: 'The companion of @bob-dev' });
    expect(second.getAttribute('class')).toContain('-scale-x-100');
    expect(within(result).getByRole('meter', { name: 'Compatibility score' }).getAttribute('aria-valuetext')).toBe('72 out of 100');
    expect(within(result).getByText('Strong pair')).toBeTruthy();

    const components = [...result.querySelectorAll<HTMLElement>('[data-component]')].map((item) => item.dataset.component);
    expect(components).toEqual(['skill', 'interest', 'rhythm', 'complement']);
    for (const name of ['Skills', 'Interests', 'Rhythm', 'Complement']) expect(within(result).getByText(name)).toBeTruthy();
    expect(within(result).getByText('82%')).toBeTruthy();
    expect(within(result).getByText('Not enough data')).toBeTruthy();
  });

  it('explains the score with real shared signals', async () => {
    render(<CompatView result={sampleCompat} />);
    expect(screen.getByText('You both build with react, postgres.')).toBeTruthy();
    expect(screen.getByText('You both starred facebook/react.')).toBeTruthy();
    expect(screen.getByText('@alice-dev brings postgres.')).toBeTruthy();
    expect(screen.getByText('@bob-dev brings docker.')).toBeTruthy();
    // The shared hours appear once the browser's timezone is known.
    await waitFor(() => {
      expect(screen.getByText(/You are both most active between/)).toBeTruthy();
    });
  });

  it('says so when there is nothing to score or nothing shared', () => {
    render(
      <CompatView
        result={{
          ...sampleCompat,
          score: null,
          band: null,
          components: { skill: null, interest: null, rhythm: null, complement: null },
          explanations: { sharedTags: [], sharedStars: [], window: null, strengthA: null, strengthB: null },
        }}
      />,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText(compatCopy.result.noScore)).toBeTruthy();
    expect(screen.getByText(compatCopy.result.nothingShared)).toBeTruthy();
    expect(screen.getAllByText('Not enough data')).toHaveLength(4);
  });

  it('copes with a band it has no words for', () => {
    render(<CompatView result={{ ...sampleCompat, band: 'future-band' }} />);
    expect(screen.getByText(compatCopy.fallbackBand.title)).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(<CompatView result={sampleCompat} />);
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('CompatTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/tools/compat');
  });

  it('prefills the signed-in member as the first person and compares on submit', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleCompat }));
    render(<CompatTool memberLogin="alice-dev" />);
    expect(screen.getByLabelText<HTMLInputElement>('First GitHub username').value).toBe('alice-dev');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Second GitHub username'), { target: { value: ' bob-dev ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await waitFor(() => {
      expect(screen.getByTestId('compat-result')).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tools/compat');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"a":"alice-dev","b":"bob-dev"}');
    expect(window.location.search).toBe('?a=alice-dev&b=bob-dev');
  });

  it('runs at once for a pair in the address', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: sampleCompat }));
    render(<CompatTool initial={{ a: 'alice-dev', b: 'bob-dev' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('compat-result')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('puts an error about one person next to their field', async () => {
    fetchMock.mockReturnValueOnce(
      reply({ status: 'error', error: { code: 'tool.invalid_input', message: 'Enter two different usernames.', field: 'b' } }, 400),
    );
    render(<CompatTool />);
    fireEvent.change(screen.getByLabelText('First GitHub username'), { target: { value: 'same' } });
    fireEvent.change(screen.getByLabelText('Second GitHub username'), { target: { value: 'same' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Second GitHub username').getAttribute('aria-invalid')).toBe('true');
    });
    expect(screen.getByLabelText('First GitHub username').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('img', { name: 'The companion is idle' })).toBeTruthy();
  });
});
