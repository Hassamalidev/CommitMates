/**
 * Commitling generator (CLAUDE.md §9.5): every companion is drawn procedurally from a
 * seed, so each member, pair and university gets a unique creature and no character art
 * is hand-drawn. Pure and deterministic: the same input always yields the same frames.
 */

export const GRID = 16;
const HALF = GRID / 2;

export type CompanionState = 'idle' | 'working' | 'waiting' | 'done' | 'error';
export type CompanionTrait = 'reviewer' | 'reviver' | 'streak' | 'oss' | 'mentor';
export const COMPANION_TRAITS: readonly CompanionTrait[] = ['reviewer', 'reviver', 'streak', 'oss', 'mentor'];

export type CompanionInput = {
  seed: number;
  species: number;
  paletteHex: string;
  /** Second member's color for pair companions: tints the left half's lower third. */
  secondaryHex?: string | undefined;
  stage: number;
  traits: readonly string[];
};

/** What a pixel is; the renderer maps roles to colors. */
export type PixelRole =
  | 'light'
  | 'base'
  | 'shade'
  | 'secondary'
  | 'outline'
  | 'eye'
  | 'pupil'
  | 'aura'
  | 'glasses'
  | 'sprout'
  | 'flame'
  | 'star'
  | 'cap';

export type Pixel = { x: number; y: number; role: PixelRole };
export type Frame = Pixel[];

export type CompanionFrames = {
  frames: Frame[];
  /** Length of one pass over the frames, in milliseconds. */
  durationMs: number;
  /** How many times the pass repeats; `null` loops forever. */
  iterations: number | null;
};

/** mulberry32: a small, fast, well-distributed seeded generator. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: turns a string id (pair, university) into a seed. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Ears = 'none' | 'pointy' | 'round';
type Species = { width: number; height: number; ears: Ears; tail: boolean; antenna: boolean; density: number };

const FIRST_SPECIES: Species = { width: 10, height: 9, ears: 'pointy', tail: true, antenna: false, density: 0.9 };

// allowed-literal: sprite design. Eight archetypes: envelope size in pixels and features.
const SPECIES: readonly Species[] = [
  FIRST_SPECIES,
  { width: 12, height: 8, ears: 'round', tail: false, antenna: false, density: 0.92 },
  { width: 8, height: 9, ears: 'none', tail: false, antenna: true, density: 0.9 },
  { width: 12, height: 9, ears: 'pointy', tail: false, antenna: false, density: 0.86 },
  { width: 10, height: 8, ears: 'round', tail: true, antenna: false, density: 0.94 },
  { width: 9, height: 9, ears: 'none', tail: true, antenna: true, density: 0.88 },
  { width: 11, height: 7, ears: 'pointy', tail: true, antenna: true, density: 0.92 },
  { width: 10, height: 9, ears: 'round', tail: false, antenna: true, density: 0.84 },
];

export const SPECIES_COUNT = SPECIES.length;

/** Species for a key such as the top skill tag or primary language. */
export function speciesFor(key: string): number {
  return hashSeed(key.toLowerCase()) % SPECIES_COUNT;
}

/** Envelope scale per evolution stage (CLAUDE.md §9.5 step 3). */
const STAGE_SCALE = [0.6, 0.75, 0.85, 1, 1] as const;
export const MAX_STAGE = STAGE_SCALE.length - 1;
/** Row of the body's vertical center; leaves room above for ears and the hop, below for feet. */
const CENTER_Y = 9;
/** Cells this close to the center are always filled, so every creature has a solid core. */
const CORE_RATIO = 0.55;

type Grid = boolean[][];

const emptyGrid = (): Grid => Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => false));
const inside = (x: number, y: number) => x >= 0 && x < GRID && y >= 0 && y < GRID;
const at = (grid: Grid, x: number, y: number) => inside(x, y) && grid[y]?.[x] === true;
const set = (grid: Grid, x: number, y: number, value: boolean) => {
  const row = grid[y];
  if (row && x >= 0 && x < GRID) row[x] = value;
};

const clampStage = (stage: number) => Math.min(MAX_STAGE, Math.max(0, Math.trunc(stage)));
const pickSpecies = (species: number): Species =>
  SPECIES[((Math.trunc(species) % SPECIES_COUNT) + SPECIES_COUNT) % SPECIES_COUNT] ?? FIRST_SPECIES;

/** Steps 3–4: the symmetric body mask, cleaned of stray pixels and holes. */
export function buildBodyMask(seed: number, species: number, stage: number): Grid {
  const shape = pickSpecies(species);
  const scale = STAGE_SCALE[clampStage(stage)] ?? 1;
  const rx = (shape.width / 2) * scale;
  const ry = (shape.height / 2) * scale;
  const rng = mulberry32(seed);
  const grid = emptyGrid();

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < HALF; x += 1) {
      // The draw happens for every cell so the sequence does not depend on the shape.
      const roll = rng();
      const dx = (x + 0.5 - HALF) / rx;
      const dy = (y + 0.5 - CENTER_Y) / ry;
      const distance = dx * dx + dy * dy;
      if (distance > 1) continue;
      if (distance <= CORE_RATIO || roll < shape.density) {
        set(grid, x, y, true);
        set(grid, GRID - 1 - x, y, true);
      }
    }
  }

  // Remove isolated pixels: fewer than two filled neighbors.
  const snapshot = grid.map((row) => [...row]);
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!at(snapshot, x, y)) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx !== 0 || dy !== 0) && at(snapshot, x + dx, y + dy)) neighbors += 1;
        }
      }
      if (neighbors < 2) set(grid, x, y, false);
    }
  }

  // Fill enclosed holes: empty cells the border cannot reach become body.
  const reached = emptyGrid();
  const queue: [number, number][] = [];
  for (let index = 0; index < GRID; index += 1) {
    queue.push([index, 0], [index, GRID - 1], [0, index], [GRID - 1, index]);
  }
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const [x, y] = next;
    if (!inside(x, y) || at(reached, x, y) || at(grid, x, y)) continue;
    set(reached, x, y, true);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!at(grid, x, y) && !at(reached, x, y)) set(grid, x, y, true);
    }
  }
  return grid;
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

function boundingBox(grid: Grid): Box {
  let left = GRID;
  let right = -1;
  let top = GRID;
  let bottom = -1;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!at(grid, x, y)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

type Feet = { left: boolean; right: boolean };

type Layout = {
  body: Grid;
  box: Box;
  shape: Species;
  /** Body-colored extras outside the mask: ears, tail, antenna. */
  features: [number, number][];
  eyeX: number;
  eyeY: number;
};

function layoutFor(input: CompanionInput): Layout {
  const body = buildBodyMask(input.seed, input.species, input.stage);
  const box = boundingBox(body);
  const shape = pickSpecies(input.species);
  const features: [number, number][] = [];
  const mirrored = (x: number, y: number) => {
    features.push([x, y], [GRID - 1 - x, y]);
  };

  // Step 5: features at positions derived from the bounding box.
  const earX = Math.min(HALF - 1, box.left + 1);
  if (shape.ears === 'pointy') {
    mirrored(earX, box.top - 1);
    mirrored(earX, box.top - 2);
  } else if (shape.ears === 'round') {
    mirrored(earX, box.top - 1);
    mirrored(Math.min(HALF - 1, earX + 1), box.top - 1);
  }
  if (shape.antenna) {
    features.push([HALF - 1, box.top - 1], [HALF - 1, box.top - 2], [HALF, box.top - 3]);
  }
  if (shape.tail) {
    features.push([box.right + 1, box.bottom - 1], [box.right + 2, box.bottom - 2]);
  }

  // Step 7: eyes at 35% of the body's height, spaced by 30% of its width.
  const eyeY = box.top + Math.max(1, Math.round(box.height * 0.35) - 1);
  const eyeOffset = Math.max(1, Math.round(box.width * 0.15));
  return { body, box, shape, features, eyeX: HALF - eyeOffset, eyeY };
}

type FrameOptions = { dy: number; feet: Feet; flatEyes: boolean };

function drawFrame(input: CompanionInput, layout: Layout, options: FrameOptions): Frame {
  const { body, box, features, eyeX, eyeY } = layout;
  const roles = new Map<string, PixelRole>();
  const key = (x: number, y: number) => `${x},${y}`;
  const put = (x: number, y: number, role: PixelRole) => {
    if (inside(x, y)) roles.set(key(x, y), role);
  };
  const lowerThird = box.bottom - Math.floor(box.height / 3);
  const upperThird = box.top + Math.floor(box.height / 3);
  const shadeFor = (x: number, y: number): PixelRole => {
    if (y > lowerThird) return input.secondaryHex !== undefined && x < HALF ? 'secondary' : 'shade';
    return y < upperThird ? 'light' : 'base';
  };

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (at(body, x, y)) put(x, y + options.dy, shadeFor(x, y));
    }
  }
  for (const [x, y] of features) put(x, y + options.dy, 'base');

  // Feet sit on the ground line, so they do not move with the hop.
  const footY = box.bottom + 1;
  const footLeft = Math.max(box.left + 1, HALF - 2);
  if (options.feet.left) put(footLeft, footY + Math.min(options.dy, 0), 'shade');
  if (options.feet.right) put(GRID - 1 - footLeft, footY + Math.min(options.dy, 0), 'shade');

  // Eyes: white above a pupil, or a flat line for the error state.
  const y = eyeY + options.dy;
  for (const x of [eyeX, GRID - 1 - eyeX]) {
    if (options.flatEyes) {
      put(x, y + 1, 'pupil');
      put(x < HALF ? x - 1 : x + 1, y + 1, 'pupil');
    } else {
      put(x, y, 'eye');
      put(x, y + 1, 'pupil');
    }
  }

  // Step 9: accessories at fixed anchors.
  const traits = new Set(input.traits);
  const headTop = box.top + options.dy;
  if (traits.has('reviewer')) {
    for (let x = eyeX - 1; x <= GRID - eyeX; x += 1) {
      if (x !== eyeX && x !== GRID - 1 - eyeX) put(x, y, 'glasses');
    }
  }
  if (traits.has('mentor')) {
    for (let x = HALF - 2; x <= HALF + 1; x += 1) put(x, headTop - 1, 'cap');
    put(HALF - 1, headTop - 2, 'cap');
    put(HALF, headTop - 2, 'cap');
  }
  if (traits.has('reviver')) {
    put(HALF, headTop - 1, 'sprout');
    put(HALF + 1, headTop - 2, 'sprout');
    put(HALF - 1, headTop - 2, 'sprout');
  }
  if (traits.has('streak')) {
    put(box.right + 1, box.top + options.dy, 'flame');
    put(box.right + 1, box.top - 1 + options.dy, 'flame');
    put(box.right + 2, box.top - 1 + options.dy, 'flame');
  }
  if (traits.has('oss')) {
    put(box.left - 1, box.top + options.dy, 'star');
    put(box.left - 2, box.top - 1 + options.dy, 'star');
  }

  // Step 6: empty cells 4-adjacent to the creature become outline.
  const filled = new Set(roles.keys());
  const neighbors = (x: number, yy: number): [number, number][] => [
    [x + 1, yy],
    [x - 1, yy],
    [x, yy + 1],
    [x, yy - 1],
  ];
  const outline = new Set<string>();
  for (const cell of filled) {
    const [x, yy] = cell.split(',').map(Number) as [number, number];
    for (const [nx, ny] of neighbors(x, yy)) {
      if (inside(nx, ny) && !filled.has(key(nx, ny))) outline.add(key(nx, ny));
    }
  }
  for (const cell of outline) roles.set(cell, 'outline');

  // Stage 4: an accent-colored aura around the outline.
  if (clampStage(input.stage) === MAX_STAGE) {
    for (const cell of outline) {
      const [x, yy] = cell.split(',').map(Number) as [number, number];
      for (const [nx, ny] of neighbors(x, yy)) {
        if (inside(nx, ny) && !roles.has(key(nx, ny))) roles.set(key(nx, ny), 'aura');
      }
    }
  }

  return [...roles.entries()]
    .map(([cell, role]) => {
      const [x, yy] = cell.split(',').map(Number) as [number, number];
      return { x, y: yy, role };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

const BOTH: Feet = { left: true, right: true };

/** Step 10: the frames of one state, left to right on the sprite sheet. */
export function generateFrames(input: CompanionInput, state: CompanionState): CompanionFrames {
  const layout = layoutFor(input);
  const frame = (dy: number, feet: Feet = BOTH, flatEyes = false) => drawFrame(input, layout, { dy, feet, flatEyes });

  switch (state) {
    case 'idle':
      return { frames: [frame(0), frame(1)], durationMs: 1200, iterations: null };
    case 'working':
      return {
        frames: [
          frame(0, { left: true, right: false }),
          frame(0),
          frame(0, { left: false, right: true }),
          frame(0),
        ],
        durationMs: 600,
        iterations: null,
      };
    case 'waiting':
      return { frames: [frame(0), frame(0, { left: true, right: false })], durationMs: 800, iterations: null };
    case 'done':
      return { frames: [frame(-2), frame(-3), frame(0)], durationMs: 450, iterations: 2 };
    case 'error':
      return { frames: [frame(1, BOTH, true)], durationMs: 0, iterations: 1 };
  }
}
