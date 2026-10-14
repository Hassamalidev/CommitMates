'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { cn } from '../lib/cn';

import { GRID, generateFrames, type CompanionInput, type CompanionState } from './generate';
import { frameToRuns, roleColors } from './render';

export type CompanionViewProps = {
  companion: CompanionInput;
  state: CompanionState;
  size?: 64 | 96 | 160 | 240;
  /**
   * Text alternative including the state, e.g. "Your companion is working". Omit only
   * when the companion is decoration next to text that already says the same thing.
   */
  label?: string;
  className?: string;
};

/**
 * Renders a Commitling as an inline SVG sprite sheet and steps through its frames with
 * CSS. Colors that depend on the theme (outline, aura) are CSS variables, so the same
 * markup works in both themes. With reduced motion only the first frame is shown.
 */
export function CompanionView({ companion, state, size = 96, label, className }: CompanionViewProps) {
  // "Done" plays its hop twice, then the companion settles back to idle (CLAUDE.md §9.5).
  const [hopFinished, setHopFinished] = useState(false);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    // A new state always starts fresh, so a second "done" hops again.
    setPreviousState(state);
    setHopFinished(false);
  }
  const visibleState: CompanionState = state === 'done' && hopFinished ? 'idle' : state;

  const { runsByFrame, durationMs, iterations } = useMemo(() => {
    const generated = generateFrames(companion, visibleState);
    const colors = roleColors(companion);
    return {
      runsByFrame: generated.frames.map((frame, index) => frameToRuns(frame, colors, index * GRID)),
      durationMs: generated.durationMs,
      iterations: generated.iterations,
    };
  }, [companion, visibleState]);

  // A timer, not `animationend`: with reduced motion the animation never runs, and the
  // companion must still come to rest.
  useEffect(() => {
    if (state !== 'done' || hopFinished || iterations === null) return;
    const timer = setTimeout(() => {
      setHopFinished(true);
    }, durationMs * iterations);
    return () => {
      clearTimeout(timer);
    };
  }, [state, hopFinished, durationMs, iterations]);

  const frameCount = runsByFrame.length;
  const animated = frameCount > 1;
  const style = {
    '--companion-shift': `${-frameCount * GRID}px`,
    animationDuration: `${durationMs}ms`,
    animationTimingFunction: `steps(${frameCount})`,
    animationIterationCount: iterations === null ? 'infinite' : String(iterations),
  } as CSSProperties;

  return (
    <svg
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-state={visibleState}
      data-frames={frameCount}
      viewBox={`0 0 ${GRID} ${GRID}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('shrink-0 overflow-hidden', className)}
    >
      <g
        // Remounting restarts the animation when the state changes.
        key={visibleState}
        className={animated ? 'companion-frames' : undefined}
        style={animated ? style : undefined}
      >
        {runsByFrame.flat().map((run) => (
          <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />
        ))}
      </g>
    </svg>
  );
}
