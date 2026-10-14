# ADR-003: Design system implementation

Date: 2026-10-14 · Status: accepted

## Context

P1-T08 builds the tokens, the Tailwind mapping, fonts, icons, the theme toggle and the base components of CLAUDE.md §9.2–9.4. Three points needed a decision, and three token values in the spec failed the spec's own contrast requirement.

## Decision

### Dependencies added

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| radix-ui | 1.8 | MIT | Accessible primitives behind Tabs, Dialog, Accordion, Toast, Tooltip, Popover, DropdownMenu |
| class-variance-authority | 0.7 | Apache-2.0 | Typed component variants |
| tailwind-merge | 3.7 | MIT | Resolving conflicting utility classes |
| `@material-symbols/svg-400` | 0.48 | Apache-2.0 | Source SVGs for the icon subset (dev dependency only) |
| `@supabase/ssr`, `@supabase/supabase-js` | 0.12, 2.117 | MIT | Auth session handling (added in P1-T07) |

Fonts (Inter, Pixelify Sans, JetBrains Mono) are OFL-1.1. `next/font/google` downloads them at build time and serves them from our own origin; no request goes to Google at runtime.

### Three light-theme colors were darkened

§9.2 requires every text/background pair to pass WCAG AA and makes `pnpm check:contrast` fail the build otherwise. Three light-theme values in the spec's own table did not pass:

| Token | Spec value | Worst ratio | New value | Worst ratio now |
| --- | --- | --- | --- | --- |
| `--accent` | #1F8F3A | 3.59:1 on `--surface-2`; 4.16:1 under white button text | #177A30 | above 4.5:1 on every surface and under `--accent-ink` |
| `--state-working` | #A86B00 | 3.80:1 on `--surface-2` | #8F5A00 | above 4.5:1 on every surface |
| `--state-done` | #15803D | 4.32:1 on `--surface-2` | #136F35 | above 4.5:1 on every surface |

State colors are checked at the body-text level (4.5:1), not the UI-glyph level (3:1), because a `StateChip` renders its label in the state color. The table in CLAUDE.md §9.2 was updated under §0.9 (factual error), with a changelog line. Dark-theme values are unchanged.

### Icons are inlined SVG paths, generated from the source package

§9.3 asks for a self-hosted subset of Material Symbols Rounded. `scripts/build-icons.ts` reads the SVGs for the icons listed in `ICON_NAMES` and writes their path data to `packages/ui/src/icons/paths.generated.ts`, which is committed. The `Icon` component draws them in `currentColor`. No icon font is shipped, so only the icons in use reach the browser. Adding an icon means adding its name to the list and running `pnpm icons:build`.

### Tailwind utility names differ from the token names

Mapping `--text` and `--bg` directly would produce utilities such as `text-text` and `bg-bg`. The Tailwind theme therefore names them `fg`, `fg-muted`, `canvas`, `line` and `line-strong` (`text-fg`, `bg-canvas`, `border-line`). The CSS variables keep the names from §9.2.

### `Select` is a native select; `Combobox` is our own

A native `<select>` already has correct keyboard, touch and screen-reader behavior on every platform. `Combobox` follows the ARIA 1.2 combobox pattern directly, since it needs free-text typeahead against server data.

### Companions are inline SVG, stepped with a CSS transform

§9.5 step 11 describes one SVG sprite sheet animated with `steps(n)` on `background-position`. A background image cannot read CSS variables from the page, and the outline must change with the theme to keep 3:1 contrast against the surface (dark outline on light, light outline on dark). `CompanionView` therefore renders the sprite sheet inline and steps a `<g>` with `transform: translateX()` and `steps(n)`: the same frames and timing, with `--companion-outline` and `--accent` resolved by the theme. `renderSpriteSheet()` still produces the standalone sheet with resolved colors for share images.

"Done" returns to idle on a timer equal to the two hops rather than on `animationend`, because with reduced motion the animation never runs and the companion must still come to rest.

Snapshot tests compare against committed files in `packages/ui/src/companion/__snapshots__` with a small helper, because Vitest 5's built-in snapshot client failed to initialize in this workspace.

### Components not in this task

`ScoreDial`, `LanguageBar`, `RhythmStrip`, `Heatmap`, `BarList` and `Timeline` are charts and arrive with the features that use them in Phase 2. `DeckCard` arrives with Discover (P4-T04).

## Alternatives considered

- **Keep the spec's light colors and check state colors at 3:1.** Rejected: chip labels are text, and the accent under white button text fails at any reading of the rule.
- **Ship the Material Symbols variable font.** Rejected: it is several megabytes for two dozen glyphs.

## Consequences

- The light theme's green is slightly darker than the spec's first draft.
- `paths.generated.ts` must be regenerated when an icon is added; a test checks every entry has path data.

## Verification

Licenses read from the npm registry on 2026-10-14 and enforced by `pnpm check:licenses`. Contrast is computed by `pnpm check:contrast` (56 pairs across both themes) on every run.
