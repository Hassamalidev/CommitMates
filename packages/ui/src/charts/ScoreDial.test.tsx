import { findA11yViolations } from '@commitmates/config/testing/axe';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScoreDial, normalizeScore } from './ScoreDial';

const formatValue = (score: number) => `${score} out of 100`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('normalizeScore', () => {
  it('rounds and clamps into 0–100', () => {
    expect(normalizeScore(72.4)).toBe(72);
    expect(normalizeScore(140)).toBe(100);
    expect(normalizeScore(-3)).toBe(0);
    expect(normalizeScore(Number.NaN)).toBe(0);
  });
});

describe('ScoreDial', () => {
  it('exposes the final value to assistive technology at once', () => {
    render(<ScoreDial score={72} label="Compatibility score" formatValue={formatValue} />);
    const meter = screen.getByRole('meter', { name: 'Compatibility score' });
    expect(meter.getAttribute('aria-valuenow')).toBe('72');
    expect(meter.getAttribute('aria-valuetext')).toBe('72 out of 100');
  });

  it('counts up to the score', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    render(<ScoreDial score={80} label="Score" formatValue={formatValue} />);
    const number = () => screen.getByRole('meter').textContent;
    expect(number()).toBe('0');
    act(() => {
      frames.shift()?.(1200);
    });
    expect(number()).toBe('40');
    act(() => {
      frames.shift()?.(1400);
    });
    expect(number()).toBe('80');
    expect(frames).toHaveLength(0);
  });

  it('shows the final value on the first frame with reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    render(<ScoreDial score={64} label="Score" formatValue={formatValue} />);
    await waitFor(() => {
      expect(screen.getByRole('meter').textContent).toBe('64');
    });
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(<ScoreDial score={50} label="Score" formatValue={formatValue} />);
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
