/**
 * The dark theme's tokens as plain colors, for share images. An image renderer cannot read
 * CSS variables, so these mirror `packages/ui/src/tokens.css`; a test keeps them in step.
 */
export const OG_COLORS = {
  bg: '#0D0F14',
  surface: '#151923',
  border: '#2A3245',
  borderStrong: '#3A4560',
  text: '#E8ECF4',
  textMuted: '#8C96AB',
  accent: '#7CFF6B',
} as const;

/** Share image size (CLAUDE.md §9.7). */
export const OG_SIZE = { width: 1200, height: 630 } as const;
