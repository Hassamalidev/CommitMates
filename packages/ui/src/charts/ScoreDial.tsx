'use client';

import { useEffect, useState } from 'react';

import { cn } from '../lib/cn';

export type ScoreDialProps = {
  /** 0–100. */
  score: number;
  /** Accessible name, e.g. "Compatibility score". The value is read as "72 out of 100". */
  label: string;
  /** How the value is read, e.g. `(score) => \`${score} out of 100\``. */
  formatValue: (score: number) => string;
  size?: 120 | 160 | 200;
  className?: string;
};

const MAX_SCORE = 100;
/** The count-up on first view (CLAUDE.md §9.9: no UI motion longer than 400 ms). */
const COUNT_UP_MS = 400;
const VIEWBOX = 100;
const STROKE = 10;
const RADIUS = (VIEWBOX - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Clamps and rounds a score into 0–100. */
export const normalizeScore = (score: number): number =>
  Number.isFinite(score) ? Math.round(Math.min(MAX_SCORE, Math.max(0, score))) : 0;

/**
 * A 0–100 radial gauge with the number in the middle (CLAUDE.md §9.4). It counts up once
 * when it appears; with reduced motion it shows the final value straight away.
 */
export function ScoreDial({ score, label, formatValue, size = 160, className }: ScoreDialProps) {
  const target = normalizeScore(score);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // With reduced motion the first frame already shows the final value.
    const duration = prefersReducedMotion() ? 0 : COUNT_UP_MS;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => window.setTimeout(() => {
            callback(performance.now());
          });
    const cancel = (id: number) => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
      else window.clearTimeout(id);
    };
    let frame = 0;
    const start = performance.now();
    const step = (time: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (time - start) / duration);
      setShown(Math.round(target * progress));
      if (progress < 1) frame = schedule(step);
    };
    frame = schedule(step);
    return () => {
      cancel(frame);
    };
  }, [target]);

  const filled = (shown / MAX_SCORE) * CIRCUMFERENCE;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={MAX_SCORE}
      aria-valuenow={target}
      aria-valuetext={formatValue(target)}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="absolute inset-0 size-full -rotate-90">
        <circle cx={VIEWBOX / 2} cy={VIEWBOX / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-surface-2" />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          className="stroke-accent"
        />
      </svg>
      <span aria-hidden="true" className="type-h1 font-mono text-fg">
        {shown}
      </span>
    </div>
  );
}
