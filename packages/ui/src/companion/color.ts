/**
 * Color math for companion palettes (CLAUDE.md §9.5 step 8): sRGB ↔ OKLCH and WCAG
 * contrast. Matrices are from Björn Ottosson's OKLab definition.
 */

export type Oklch = { l: number; c: number; h: number };

const HEX = /^#?([0-9a-f]{6})$/i;
/** Used when a language has no color or the input is malformed: a neutral mid grey. */
export const FALLBACK_HEX = '#8c96ab';

function parseHex(hex: string): [number, number, number] {
  const match = HEX.exec(hex.trim());
  const digits = match?.[1] ?? FALLBACK_HEX.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const toGamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bAxis, a) * 180) / Math.PI;
  return { l: lightness, c: Math.hypot(a, bAxis), h: hue < 0 ? hue + 360 : hue };
}

/** Converts back to sRGB, clipping channels that fall outside the gamut. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
  return `#${rgb
    .map((channel) =>
      Math.round(clamp01(toGamma(clamp01(channel))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export type CompanionPalette = { base: string; light: string; shade: string };

/** Lightness step between base, light and shade (CLAUDE.md §9.5). */
const LIGHTNESS_STEP = 0.12;
/** Body colors stay inside this lightness band so highlights and shadows remain visible. */
const MIN_BASE_L = 0.35;
const MAX_BASE_L = 0.8;

/** Base, light (+0.12 L) and shade (−0.12 L) derived from one color in OKLCH. */
export function derivePalette(hex: string): CompanionPalette {
  const source = hexToOklch(HEX.test(hex.trim()) ? hex : FALLBACK_HEX);
  const base = { ...source, l: Math.min(MAX_BASE_L, Math.max(MIN_BASE_L, source.l)) };
  return {
    base: oklchToHex(base),
    light: oklchToHex({ ...base, l: clamp01(base.l + LIGHTNESS_STEP) }),
    shade: oklchToHex({ ...base, l: clamp01(base.l - LIGHTNESS_STEP) }),
  };
}

/** Lightness of the default dark outline (CLAUDE.md §9.5). */
const OUTLINE_L = 0.2;
/** Lightness of the outline used on dark surfaces, where the dark one would vanish. */
const OUTLINE_L_ON_DARK = 0.88;
const OUTLINE_CHROMA = 0.03;
/** WCAG minimum for UI glyphs. */
const MIN_OUTLINE_CONTRAST = 3;

/**
 * The outline color for a palette on a given surface: the hue-tinted dark outline of the
 * spec when it reaches 3:1 against the surface, otherwise its light counterpart.
 */
export function outlineFor(paletteHex: string, surfaceHex: string): string {
  const { h } = hexToOklch(HEX.test(paletteHex.trim()) ? paletteHex : FALLBACK_HEX);
  const dark = oklchToHex({ l: OUTLINE_L, c: OUTLINE_CHROMA, h });
  if (contrastRatio(dark, surfaceHex) >= MIN_OUTLINE_CONTRAST) return dark;
  return oklchToHex({ l: OUTLINE_L_ON_DARK, c: OUTLINE_CHROMA, h });
}
