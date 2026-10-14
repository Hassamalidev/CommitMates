import type { CompatResult } from '@commitmates/core';

/** A comparison of two invented accounts, in the shape `compat_check` stores. */
export const sampleCompat: CompatResult = {
  a: {
    login: 'alice-dev',
    name: 'Alice',
    githubId: 1001,
    isMember: false,
    companion: { seed: 1001, speciesKey: 'react', paletteHex: '#3178c6', stage: 2, traits: [] },
  },
  b: {
    login: 'bob-dev',
    name: null,
    githubId: 1002,
    isMember: false,
    companion: { seed: 1002, speciesKey: 'docker', paletteHex: null, stage: 1, traits: [] },
  },
  score: 72,
  band: 'strong-pair',
  components: { skill: 0.82, interest: 0.25, rhythm: 0.5, complement: null },
  explanations: {
    sharedTags: ['react', 'postgres'],
    sharedStars: ['facebook/react'],
    window: { startHourUtc: 21, hours: 2 },
    strengthA: 'postgres',
    strengthB: 'docker',
  },
};
