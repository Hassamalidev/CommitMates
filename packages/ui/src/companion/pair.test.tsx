import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { findA11yViolations } from '@commitmates/config/testing/axe';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StreakStrip } from '../charts/StreakStrip';

import { MAX_STAGE, generateFrames } from './generate';
import { pairCompanion, pairCompanionState, type PairMood } from './pair';
import { renderSpriteSheet } from './render';

const SNAPSHOT_DIR = path.join(process.cwd(), 'src/companion/__snapshots__');
const sheetOptions = { surfaceHex: '#151923', accentHex: '#7cff6b' };
const source = { seed: 2_718_281_828, stage: 0, primaryHex: '#3178c6', secondaryHex: '#dea584' };
const MOODS: PairMood[] = ['happy', 'neutral', 'sad'];

// Committed snapshot files, as in companion.test.tsx: written locally when missing, never in CI.
function expectStoredSnapshot(name: string, actual: string): void {
  const file = path.join(SNAPSHOT_DIR, name);
  if (!existsSync(file)) {
    if (process.env.CI) throw new Error(`Missing snapshot ${name}; run the tests locally and commit it.`);
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(file, actual);
  }
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

describe('pair companion', () => {
  it('is two-toned, grows with the stage up to the last drawable one, and wears the flame during a streak', () => {
    expect(pairCompanion({ ...source, stage: 9 }, 40)).toMatchObject({ stage: MAX_STAGE, secondaryHex: '#dea584', traits: ['streak'] });
    expect(pairCompanion(source, 0)).toMatchObject({ stage: 0, traits: [] });
    const firstFrame = (stage: number) => generateFrames(pairCompanion({ ...source, stage }, 0), 'idle').frames[0] ?? [];
    const roles = (stage: number) => new Set(firstFrame(stage).map((pixel) => pixel.role));
    expect(roles(2).has('secondary')).toBe(true);
    // Each stage is a bigger creature.
    const sizes = [0, 1, 2, 3].map((stage) => firstFrame(stage).length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it('shows its mood: a hop after a counted day, rest after a frozen one, a slump after a miss', () => {
    expect(MOODS.map(pairCompanionState)).toEqual(['done', 'idle', 'error']);
  });

  it.each(MOODS)('matches the snapshot at every stage when %s', (mood) => {
    const sheets = Array.from({ length: MAX_STAGE + 1 }, (_, stage) =>
      renderSpriteSheet(pairCompanion({ ...source, stage }, stage), pairCompanionState(mood), sheetOptions),
    );
    expectStoredSnapshot(`pair-companion-${mood}.svg.txt`, `${sheets.join('\n')}\n`);
  });
});

describe('StreakStrip', () => {
  it('lists each day for screen readers with a legend, accessibly', async () => {
    const { container } = render(
      <main>
        <StreakStrip
          label="The last 4 days"
          days={[
            { day: '2026-10-17', outcome: null },
            { day: '2026-10-18', outcome: 'counted' },
            { day: '2026-10-19', outcome: 'frozen' },
            { day: '2026-10-20', outcome: 'missed' },
          ]}
          outcomeLabels={{ counted: 'Both coded', frozen: 'Freeze used', missed: 'Missed', none: 'Not judged' }}
          describeDay={(day) => `${day.day}: ${day.outcome ?? 'not judged'}`}
        />
      </main>,
    );
    expect(screen.getByText('The last 4 days')).toBeInTheDocument();
    expect(screen.getByText('2026-10-19: frozen')).toBeInTheDocument();
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
