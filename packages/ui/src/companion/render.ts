import { derivePalette, outlineFor } from './color';
import { GRID, generateFrames, type CompanionInput, type CompanionState, type Frame, type PixelRole } from './generate';

/** Colors for every pixel role. Strings may be hex values or CSS `var()` references. */
export type RoleColors = Record<PixelRole, string>;

// allowed-literal: sprite design. Accessory colors are part of the drawing, like the shapes.
const ACCESSORY_COLORS = {
  eye: '#ffffff',
  pupil: '#12151c',
  glasses: '#12151c',
  sprout: '#3fb950',
  flame: '#ff8a3d',
  star: '#f5c542',
  cap: '#2f3b57',
} as const;

export type ColorOptions = {
  /** Outline color; defaults to the theme token so inline companions follow the theme. */
  outline?: string;
  /** Aura color for stage 4; defaults to the accent token. */
  aura?: string;
};

export function roleColors(input: CompanionInput, options: ColorOptions = {}): RoleColors {
  const palette = derivePalette(input.paletteHex);
  const secondary = input.secondaryHex === undefined ? palette.shade : derivePalette(input.secondaryHex).shade;
  return {
    ...ACCESSORY_COLORS,
    light: palette.light,
    base: palette.base,
    shade: palette.shade,
    secondary,
    outline: options.outline ?? 'var(--companion-outline)',
    aura: options.aura ?? 'var(--accent)',
  };
}

export type Run = { x: number; y: number; width: number; fill: string };

/** Merges horizontally adjacent pixels of one color into a single rectangle. */
export function frameToRuns(frame: Frame, colors: RoleColors, offsetX = 0): Run[] {
  const runs: Run[] = [];
  for (const pixel of frame) {
    const fill = colors[pixel.role];
    const last = runs.at(-1);
    if (last?.y === pixel.y && last.fill === fill && last.x + last.width === pixel.x + offsetX) {
      last.width += 1;
    } else {
      runs.push({ x: pixel.x + offsetX, y: pixel.y, width: 1, fill });
    }
  }
  return runs;
}

export type SpriteSheetOptions = {
  /** The surface the image sits on; decides between the dark and the light outline. */
  surfaceHex: string;
  /** Aura color for stage 4. */
  accentHex: string;
};

/**
 * A standalone SVG sprite sheet: the frames of one state side by side, as crisp rects.
 * Used where CSS variables are not available (share images, downloads).
 */
export function renderSpriteSheet(
  input: CompanionInput,
  state: CompanionState,
  options: SpriteSheetOptions,
): string {
  return renderFrames(generateFrames(input, state).frames, input, options);
}

/** A single still image of the companion at rest: icons and share images. */
export function renderStill(input: CompanionInput, options: SpriteSheetOptions): string {
  return renderFrames(generateFrames(input, 'idle').frames.slice(0, 1), input, options);
}

function renderFrames(frames: Frame[], input: CompanionInput, options: SpriteSheetOptions): string {
  const colors = roleColors(input, {
    outline: outlineFor(input.paletteHex, options.surfaceHex),
    aura: options.accentHex,
  });
  const rects = frames
    .flatMap((frame, index) => frameToRuns(frame, colors, index * GRID))
    .map((run) => `<rect x="${run.x}" y="${run.y}" width="${run.width}" height="1" fill="${run.fill}"/>`)
    .join('');
  const width = frames.length * GRID;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${GRID}" width="${width}" height="${GRID}" shape-rendering="crispEdges">${rects}</svg>`;
}
