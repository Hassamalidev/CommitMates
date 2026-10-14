import { hashSeed, speciesFor, type CompanionInput } from '@commitmates/ui';

import { siteName } from './site';

/** The site's own mascot, generated from the site name like any other companion (CLAUDE.md §9.5). */
export const brandCompanion: CompanionInput = {
  seed: hashSeed(siteName),
  species: speciesFor(siteName),
  // The dark theme's accent green; the palette is derived from it.
  paletteHex: '#7cff6b',
  stage: 3,
  traits: [],
};
