import type { Icebreaker, IcebreakerKey } from '@commitmates/core';

/**
 * Openers for a first message (CLAUDE.md §8 F12 step 1): templates filled with one real shared
 * signal from the suggestion. Never generated text (§2.1).
 */
export const icebreakerTemplates = {
  sharedTag: (tag: string) => `Hi! I see we both build with ${tag}. Want to compare notes, or build something together?`,
  learning: (tag: string) => `Hi! I'm learning ${tag} and you know it well. Could I ask you a few questions about it?`,
  interests: (count: string) => `Hi! We share ${count} topics across our repos and stars. Want to chat about what you're working on?`,
} satisfies Record<IcebreakerKey, (value: string) => string>;

/** The opener's text for an icebreaker. */
export const renderIcebreaker = (icebreaker: Icebreaker): string => icebreakerTemplates[icebreaker.key](icebreaker.value);
