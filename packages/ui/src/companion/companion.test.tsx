import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findA11yViolations } from '@commitmates/config/testing/axe';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompanionView } from './CompanionView';
import { SpeechBubble } from './SpeechBubble';
import { contrastRatio, derivePalette, hexToOklch, oklchToHex, outlineFor } from './color';
import {
  GRID,
  MAX_STAGE,
  SPECIES_COUNT,
  buildBodyMask,
  generateFrames,
  hashSeed,
  mulberry32,
  speciesFor,
  type CompanionInput,
  type CompanionState,
} from './generate';
import { frameToRuns, renderSpriteSheet, roleColors } from './render';

const STATES: CompanionState[] = ['idle', 'working', 'waiting', 'done', 'error'];
const DARK_SURFACE = '#151923';
const LIGHT_SURFACE = '#ffffff';
const sheetOptions = { surfaceHex: DARK_SURFACE, accentHex: '#7cff6b' };

const companion = (overrides: Partial<CompanionInput> = {}): CompanionInput => ({
  seed: 583231,
  species: 0,
  paletteHex: '#3178c6',
  stage: 2,
  traits: [],
  ...overrides,
});

const filledCount = (grid: boolean[][]) => grid.flat().filter(Boolean).length;

// Vitest runs from the package root. Snapshots are committed files: a missing one is
// written locally and must be reviewed; in CI a missing or different one fails.
const SNAPSHOT_DIR = path.join(process.cwd(), 'src/companion/__snapshots__');

function expectStoredSnapshot(name: string, actual: string): void {
  const file = path.join(SNAPSHOT_DIR, name);
  if (!existsSync(file)) {
    if (process.env.CI) throw new Error(`Missing snapshot ${name}; run the tests locally and commit it.`);
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(file, actual);
  }
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

describe('seeded randomness', () => {
  it('mulberry32 is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(190);
    expect(mulberry32(43)()).not.toBe(values[0]);
  });

  it('hashSeed and speciesFor are stable', () => {
    expect(hashSeed('pair:abc')).toBe(hashSeed('pair:abc'));
    expect(hashSeed('pair:abc')).not.toBe(hashSeed('pair:abd'));
    expect(speciesFor('React')).toBe(speciesFor('react'));
    expect(speciesFor('react')).toBeGreaterThanOrEqual(0);
    expect(speciesFor('react')).toBeLessThan(SPECIES_COUNT);
  });
});

describe('body mask', () => {
  it('is mirror-symmetric for every species and stage', () => {
    for (let species = 0; species < SPECIES_COUNT; species += 1) {
      for (let stage = 0; stage <= MAX_STAGE; stage += 1) {
        const grid = buildBodyMask(1000 + species, species, stage);
        for (const row of grid) expect(row).toEqual([...row].reverse());
        expect(filledCount(grid)).toBeGreaterThan(8);
      }
    }
  });

  it('has no isolated pixels and no enclosed holes', () => {
    for (const seed of [1, 7, 583231, 99999, 4294967295]) {
      const grid = buildBodyMask(seed, seed % SPECIES_COUNT, 3);
      const filled = (x: number, y: number) => grid[y]?.[x] === true;
      for (let y = 0; y < GRID; y += 1) {
        for (let x = 0; x < GRID; x += 1) {
          if (!filled(x, y)) continue;
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if ((dx !== 0 || dy !== 0) && filled(x + dx, y + dy)) neighbors += 1;
            }
          }
          expect(neighbors, `seed ${seed} pixel ${x},${y}`).toBeGreaterThanOrEqual(1);
        }
      }
      // Flood from the border: every empty cell must be reachable.
      const seen = new Set<string>();
      const queue: [number, number][] = [[0, 0]];
      while (queue.length > 0) {
        const [x, y] = queue.pop()!;
        const key = `${x},${y}`;
        if (x < 0 || y < 0 || x >= GRID || y >= GRID || seen.has(key) || filled(x, y)) continue;
        seen.add(key);
        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      expect(seen.size + filledCount(grid)).toBe(GRID * GRID);
    }
  });

  it('grows with the stage', () => {
    const sizes = [0, 1, 2, 3].map((stage) => filledCount(buildBodyMask(583231, 1, stage)));
    expect(sizes[0]!).toBeLessThan(sizes[1]!);
    expect(sizes[1]!).toBeLessThan(sizes[2]!);
    expect(sizes[2]!).toBeLessThan(sizes[3]!);
  });

  it('differs between seeds and tolerates out-of-range species and stages', () => {
    const shapes = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(buildBodyMask(seed, 3, 3))));
    expect(shapes.size).toBeGreaterThan(3);
    expect(buildBodyMask(5, -1, 99)).toEqual(buildBodyMask(5, SPECIES_COUNT - 1, MAX_STAGE));
  });
});

describe('generateFrames', () => {
  it('produces the frame counts and timings of each state', () => {
    const shape = (state: CompanionState) => {
      const { frames, durationMs, iterations } = generateFrames(companion(), state);
      return { frames: frames.length, durationMs, iterations };
    };
    expect(shape('idle')).toEqual({ frames: 2, durationMs: 1200, iterations: null });
    expect(shape('working')).toEqual({ frames: 4, durationMs: 600, iterations: null });
    expect(shape('waiting')).toEqual({ frames: 2, durationMs: 800, iterations: null });
    expect(shape('done')).toEqual({ frames: 3, durationMs: 450, iterations: 2 });
    expect(shape('error')).toEqual({ frames: 1, durationMs: 0, iterations: 1 });
  });

  it('is deterministic for the same input', () => {
    for (const state of STATES) {
      expect(generateFrames(companion(), state)).toEqual(generateFrames(companion(), state));
    }
  });

  it('keeps every pixel on the grid and at most one role per cell', () => {
    for (let species = 0; species < SPECIES_COUNT; species += 1) {
      for (const state of STATES) {
        const input = companion({ species, seed: 77 + species, stage: 4, traits: ['reviewer', 'mentor', 'streak', 'oss'] });
        for (const frame of generateFrames(input, state).frames) {
          expect(frame.every((pixel) => pixel.x >= 0 && pixel.x < GRID && pixel.y >= 0 && pixel.y < GRID)).toBe(true);
          expect(new Set(frame.map((pixel) => `${pixel.x},${pixel.y}`)).size).toBe(frame.length);
        }
      }
    }
  });

  it('shifts the body between idle frames and hops when done', () => {
    const top = (frame: { y: number; role: string }[]) =>
      Math.min(...frame.filter((pixel) => pixel.role === 'light' || pixel.role === 'base').map((pixel) => pixel.y));
    const idle = generateFrames(companion(), 'idle').frames;
    expect(top(idle[1]!) - top(idle[0]!)).toBe(1);
    const done = generateFrames(companion(), 'done').frames;
    expect([top(done[0]!), top(done[1]!), top(done[2]!)].map((value) => value - top(idle[0]!))).toEqual([-2, -3, 0]);
  });

  it('draws open eyes normally and flat eyes on error', () => {
    const count = (state: CompanionState, role: string) =>
      generateFrames(companion(), state).frames[0]!.filter((pixel) => pixel.role === role).length;
    expect(count('idle', 'eye')).toBe(2);
    expect(count('idle', 'pupil')).toBe(2);
    expect(count('error', 'eye')).toBe(0);
    expect(count('error', 'pupil')).toBe(4);
  });

  it('alternates feet while working', () => {
    const feetRow = (frame: { x: number; y: number; role: string }[]) => {
      const bottom = Math.max(...frame.filter((pixel) => pixel.role !== 'outline' && pixel.role !== 'aura').map((pixel) => pixel.y));
      return frame.filter((pixel) => pixel.y === bottom && pixel.role === 'shade').map((pixel) => pixel.x);
    };
    const frames = generateFrames(companion({ species: 2 }), 'working').frames;
    expect(feetRow(frames[0]!)).not.toEqual(feetRow(frames[2]!));
    expect(feetRow(frames[1]!)).toEqual(feetRow(frames[3]!));
  });

  it('stamps one accessory per trait and an aura at the top stage', () => {
    const roles = (input: CompanionInput) => new Set(generateFrames(input, 'idle').frames[0]!.map((pixel) => pixel.role));
    const plain = roles(companion());
    for (const role of ['glasses', 'sprout', 'flame', 'star', 'cap', 'aura', 'secondary'] as const) {
      expect(plain.has(role)).toBe(false);
    }
    const decorated = roles(companion({ traits: ['reviewer', 'reviver', 'streak', 'oss', 'mentor', 'unknown'] }));
    expect(decorated.has('glasses') && decorated.has('flame') && decorated.has('star')).toBe(true);
    expect(decorated.has('sprout') || decorated.has('cap')).toBe(true);
    expect(roles(companion({ stage: 4 })).has('aura')).toBe(true);
    expect(roles(companion({ stage: 3 })).has('aura')).toBe(false);
    expect(roles(companion({ secondaryHex: '#f1e05a' })).has('secondary')).toBe(true);
  });

  it('surrounds the creature with an outline', () => {
    const frame = generateFrames(companion(), 'idle').frames[0]!;
    const role = new Map(frame.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.role]));
    for (const pixel of frame) {
      if (pixel.role === 'outline') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = pixel.x + dx;
        const y = pixel.y + dy;
        if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
        expect(role.has(`${x},${y}`), `neighbor of ${pixel.x},${pixel.y}`).toBe(true);
      }
    }
  });
});

describe('colors', () => {
  it('round-trips through OKLCH', () => {
    for (const hex of ['#3178c6', '#f1e05a', '#000000', '#ffffff', '#dea584']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it('derives a lighter and a darker shade around the base', () => {
    const { base, light, shade } = derivePalette('#3178c6');
    expect(hexToOklch(light).l - hexToOklch(base).l).toBeCloseTo(0.12, 1);
    expect(hexToOklch(base).l - hexToOklch(shade).l).toBeCloseTo(0.12, 1);
  });

  it('keeps extreme and malformed colors usable', () => {
    expect(hexToOklch(derivePalette('#000000').base).l).toBeGreaterThanOrEqual(0.34);
    expect(hexToOklch(derivePalette('#ffffff').base).l).toBeLessThanOrEqual(0.81);
    expect(derivePalette('not-a-color')).toEqual(derivePalette('#8c96ab'));
  });

  it('gives the outline at least 3:1 contrast on both surfaces', () => {
    for (const hex of ['#3178c6', '#f1e05a', '#dea584', '#e34c26', '#000000', '#ffffff', 'bad']) {
      for (const surface of [DARK_SURFACE, LIGHT_SURFACE, '#1c2230', '#f0eee8', '#0d0f14', '#f7f6f2']) {
        expect(contrastRatio(outlineFor(hex, surface), surface), `${hex} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(outlineFor('#3178c6', LIGHT_SURFACE)).not.toBe(outlineFor('#3178c6', DARK_SURFACE));
  });
});

describe('rendering', () => {
  it('merges adjacent pixels of one color into runs', () => {
    const colors = roleColors(companion(), { outline: '#111111', aura: '#00ff00' });
    const runs = frameToRuns(
      [
        { x: 2, y: 5, role: 'base' },
        { x: 3, y: 5, role: 'base' },
        { x: 4, y: 5, role: 'outline' },
        { x: 6, y: 5, role: 'outline' },
        { x: 2, y: 6, role: 'base' },
      ],
      colors,
      16,
    );
    expect(runs.map((run) => [run.x, run.y, run.width])).toEqual([
      [18, 5, 2],
      [20, 5, 1],
      [22, 5, 1],
      [18, 6, 1],
    ]);
  });

  it('uses theme variables inline and resolved colors in a standalone sheet', () => {
    expect(roleColors(companion())).toMatchObject({ outline: 'var(--companion-outline)', aura: 'var(--accent)' });
    const svg = renderSpriteSheet(companion({ stage: 4 }), 'idle', sheetOptions);
    expect(svg).not.toContain('var(');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 32 16"');
    expect(svg).toContain('fill="#7cff6b"');
  });

  it('always produces the same SVG for the same seed', () => {
    for (const state of STATES) {
      expect(renderSpriteSheet(companion(), state, sheetOptions)).toBe(renderSpriteSheet(companion(), state, sheetOptions));
    }
    expect(renderSpriteSheet(companion({ seed: 1 }), 'idle', sheetOptions)).not.toBe(
      renderSpriteSheet(companion({ seed: 2 }), 'idle', sheetOptions),
    );
  });

  it.each(STATES)('matches the snapshot for fixed seeds in the %s state', (state) => {
    const sheets = [
      companion(),
      companion({ seed: 9, species: 5, paletteHex: '#f1e05a', stage: 4, traits: ['reviewer', 'streak'] }),
      companion({ seed: hashSeed('pair:1'), species: 3, paletteHex: '#dea584', secondaryHex: '#3572a5', stage: 1 }),
    ].map((input) => renderSpriteSheet(input, state, sheetOptions));
    expectStoredSnapshot(`companion-${state}.svg.txt`, `${sheets.join('\n')}\n`);
  });
});

describe('CompanionView', () => {
  it('is an image with a state label and steps through its frames', async () => {
    const { container } = render(
      <main>
        <h1>Dev Card</h1>
        <CompanionView companion={companion()} state="working" label="Your companion is working" size={160} />
      </main>,
    );
    const image = screen.getByRole('img', { name: 'Your companion is working' });
    expect(image).toHaveAttribute('width', '160');
    expect(image).toHaveAttribute('data-state', 'working');
    expect(image).toHaveAttribute('data-frames', '4');
    const group = image.querySelector('g')!;
    expect(group).toHaveClass('companion-frames');
    expect(group.style.animationTimingFunction).toBe('steps(4)');
    expect(group.style.animationDuration).toBe('600ms');
    expect(group.style.getPropertyValue('--companion-shift')).toBe('-64px');
    expect(await findA11yViolations(container)).toEqual([]);
  });

  it('does not animate a single-frame state', () => {
    render(<CompanionView companion={companion()} state="error" label="Your companion hit an error" />);
    const group = screen.getByRole('img').querySelector('g')!;
    expect(group).not.toHaveClass('companion-frames');
  });

  it('settles from done back to idle after two hops, and hops again next time', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<CompanionView companion={companion()} state="done" label="Your companion is done" />);
      const image = screen.getByRole('img');
      expect(image).toHaveAttribute('data-state', 'done');
      expect(image.querySelector('g')!.style.animationIterationCount).toBe('2');

      act(() => {
        vi.advanceTimersByTime(899);
      });
      expect(image).toHaveAttribute('data-state', 'done');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(image).toHaveAttribute('data-state', 'idle');

      rerender(<CompanionView companion={companion()} state="working" label="Your companion is working" />);
      rerender(<CompanionView companion={companion()} state="done" label="Your companion is done" />);
      expect(screen.getByRole('img')).toHaveAttribute('data-state', 'done');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SpeechBubble', () => {
  it('announces live updates politely and stays silent otherwise', async () => {
    const { container, rerender } = render(<SpeechBubble live>Reading 42 repos…</SpeechBubble>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(await findA11yViolations(container)).toEqual([]);
    rerender(<SpeechBubble tail="bottom">All done</SpeechBubble>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('All done')).toBeVisible();
  });
});
