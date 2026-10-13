/**
 * WCAG 2.2 contrast checks for design tokens (CLAUDE.md §9.2).
 * Formula: ratio = (L1 + 0.05) / (L2 + 0.05), with L the relative luminance of sRGB.
 */

/** Minimum ratio for body text (WCAG 2.2 SC 1.4.3). */
export const AA_TEXT = 4.5;
/** Minimum ratio for large text, UI components and glyphs (WCAG 2.2 SC 1.4.3, 1.4.11). */
export const AA_UI = 3;

export type Rgb = readonly [number, number, number];

/** token name → raw value, per theme. */
export type ThemeTokens = Record<string, Record<string, string>>;

export type ContrastRule = {
  foreground: string;
  background: string;
  min: number;
  /** What the pair is used for; shown when it fails. */
  use: string;
};

export type ContrastFailure = ContrastRule & { theme: string; ratio: number };

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Digits in the short `#rgb` form. */
const SHORT_HEX_LENGTH = 3;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;

export function parseHex(hex: string): Rgb {
  const match = HEX_COLOR.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Not a hex color: ${hex}`);
  const digits = match[1].length === SHORT_HEX_LENGTH ? match[1].replace(/./g, '$&$&') : match[1];
  const channel = (offset: number) => Number.parseInt(digits.slice(offset, offset + 2), HEX_RADIX);
  return [channel(0), channel(2), channel(4)]; // allowed-literal: byte offsets of R, G, B in RRGGBB
}

/** Relative luminance as defined by WCAG; constants are from the sRGB specification. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (value: number) => {
    const channel = value / CHANNEL_MAX;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const THEME_BLOCK = /:root\[data-theme=["']([\w-]+)["']\]\s*\{([^}]*)\}/g;
const DECLARATION = /(--[\w-]+)\s*:\s*([^;]+);/g;

/** Reads `:root[data-theme="…"] { --token: value; }` blocks from a tokens stylesheet. */
export function parseTokens(css: string): ThemeTokens {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const themes: ThemeTokens = {};
  for (const block of withoutComments.matchAll(THEME_BLOCK)) {
    const [, theme, body] = block;
    if (!theme || body === undefined) continue;
    const tokens = (themes[theme] ??= {});
    for (const declaration of body.matchAll(DECLARATION)) {
      const [, name, value] = declaration;
      if (name && value) tokens[name] = value.trim();
    }
  }
  return themes;
}

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/;
/** Longest chain of var() references followed before giving up on a cycle. */
const MAX_VAR_DEPTH = 8;

/** Resolves a token to a hex color, following `var(--other)` references. */
export function resolveToken(tokens: Record<string, string>, name: string): string {
  let current = name;
  for (let depth = 0; depth < MAX_VAR_DEPTH; depth += 1) {
    const value = tokens[current];
    if (value === undefined) throw new Error(`Token ${current} is not defined`);
    const reference = VAR_REFERENCE.exec(value);
    if (!reference?.[1]) return value;
    current = reference[1];
  }
  throw new Error(`Token ${name} has a circular reference`);
}

/** Checks every rule in every theme and returns the pairs below their minimum. */
export function checkContrast(themes: ThemeTokens, rules: readonly ContrastRule[]): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const rule of rules) {
      const ratio = contrastRatio(
        parseHex(resolveToken(tokens, rule.foreground)),
        parseHex(resolveToken(tokens, rule.background)),
      );
      if (ratio < rule.min) failures.push({ ...rule, theme, ratio });
    }
  }
  return failures;
}

export function formatContrastFailure(failure: ContrastFailure): string {
  return `[${failure.theme}] ${failure.foreground} on ${failure.background}: ${failure.ratio.toFixed(2)}:1, needs ${failure.min}:1 (${failure.use})`;
}

const SURFACES = ['--bg', '--surface', '--surface-2'] as const;
const TEXT_TOKENS = ['--text', '--text-muted'] as const;
const STATE_TOKENS = ['--state-idle', '--state-working', '--state-waiting', '--state-done', '--state-error'] as const;

/**
 * The pairs the design system actually renders (CLAUDE.md §9.2, §9.4): text on every
 * surface, text on the accent, state colors as chip labels and accent as link text on
 * every surface (all body-size text), and the focus ring as a UI component.
 */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  ...SURFACES.flatMap((background) =>
    TEXT_TOKENS.map((foreground) => ({ foreground, background, min: AA_TEXT, use: 'text' })),
  ),
  { foreground: '--accent-ink', background: '--accent', min: AA_TEXT, use: 'text on primary buttons' },
  ...SURFACES.flatMap((background) =>
    STATE_TOKENS.map((foreground) => ({ foreground, background, min: AA_TEXT, use: 'state chip label' })),
  ),
  ...SURFACES.map((background) => ({ foreground: '--accent', background, min: AA_TEXT, use: 'links and accent text' })),
  ...SURFACES.map((background) => ({ foreground: '--focus', background, min: AA_UI, use: 'focus ring' })),
];
