import { publicSiteName } from '@commitmates/env/public';
import { hashSeed, speciesFor, type CompanionInput } from '@commitmates/ui';

// Read without zod: this module is in every client bundle that shows the mascot.
const siteName = publicSiteName();

/** The site's own mascot, generated from the site name like any other companion (CLAUDE.md §9.5). */
export const brandCompanion: CompanionInput = {
  seed: hashSeed(siteName),
  species: speciesFor(siteName),
  // The dark theme's accent green; the palette is derived from it.
  paletteHex: '#7cff6b',
  stage: 3,
  traits: [],
};
