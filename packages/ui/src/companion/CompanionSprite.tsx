import type { CSSProperties } from 'react';

import { cn } from '../lib/cn';

import { GRID, generateFrames, type CompanionInput, type CompanionState } from './generate';
import { frameToRuns, roleColors, runsToPaths } from './render';

export type CompanionSpriteProps = {
  companion: CompanionInput;
  state: CompanionState;
  size?: 64 | 96 | 160 | 240;
  /** Text alternative including the state; omit only when the companion is decoration. */
  label?: string | undefined;
  className?: string | undefined;
};

/**
 * Draws a Commitling as an inline SVG sprite sheet, one path per color, and steps through its
 * frames with CSS. It has no hooks, so a server component renders it to plain markup. Colors that depend on
 * the theme (outline, aura) are CSS variables, so the same markup works in both themes.
 * With reduced motion only the first frame is shown.
 */
export function CompanionSprite({ companion, state, size = 96, label, className }: CompanionSpriteProps) {
  const generated = generateFrames(companion, state);
  const colors = roleColors(companion);
  const frameCount = generated.frames.length;
  const paths = runsToPaths(generated.frames.flatMap((frame, index) => frameToRuns(frame, colors, index * GRID)));
  const animated = frameCount > 1;
  const style = {
    '--companion-shift': `${-frameCount * GRID}px`,
    animationDuration: `${generated.durationMs}ms`,
    animationTimingFunction: `steps(${frameCount})`,
    animationIterationCount: generated.iterations === null ? 'infinite' : String(generated.iterations),
  } as CSSProperties;

  return (
    <svg
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-state={state}
      data-frames={frameCount}
      viewBox={`0 0 ${GRID} ${GRID}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('shrink-0 overflow-hidden', className)}
    >
      <g
        // Remounting restarts the animation when the state changes.
        key={state}
        className={animated ? 'companion-frames' : undefined}
        style={animated ? style : undefined}
      >
        {paths.map((path) => (
          <path key={path.fill} d={path.d} fill={path.fill} />
        ))}
      </g>
    </svg>
  );
}
