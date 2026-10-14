import {
  compatBand,
  compatComponents,
  compatExplanations,
  compatScore,
  type CompatSide,
} from '@commitmates/algorithms';
import { getSetting } from '@commitmates/db';
import type { StarredRepo } from '@commitmates/github';

import type { DevCard } from '../persona/schemas';

import type { CompatResult, CompatSideSummary } from './schemas';

/** What the comparison reads from one person: their card plus what they starred. */
export function compatSide(card: DevCard, starred: readonly StarredRepo[]): CompatSide {
  return {
    languages: card.languages,
    tags: card.tags,
    topics: [...new Set([...card.topics, ...starred.flatMap((repo) => repo.topics)])],
    hourHistUtc: card.hourHistUtc,
    starred: starred.map((repo) => repo.fullName),
  };
}

const summary = (card: DevCard): CompatSideSummary => ({
  login: card.login,
  name: card.name,
  githubId: card.githubId,
  isMember: card.isMember,
  companion: card.companion,
});

/**
 * The Compatibility Check (CLAUDE.md §8 F2 "Algorithm"): four components, a weighted
 * score re-normalized over the components that exist, a band, and explanations made
 * only of real shared signals.
 */
export async function buildCompat(
  a: { card: DevCard; starred: readonly StarredRepo[] },
  b: { card: DevCard; starred: readonly StarredRepo[] },
): Promise<CompatResult> {
  const [weights, bands] = await Promise.all([getSetting('compat.weights'), getSetting('compat.bands')]);
  const sideA = compatSide(a.card, a.starred);
  const sideB = compatSide(b.card, b.starred);
  const components = compatComponents(sideA, sideB);
  const score = compatScore(components, weights);
  return {
    a: summary(a.card),
    b: summary(b.card),
    score,
    band: score === null ? null : compatBand(score, bands),
    components,
    explanations: compatExplanations(sideA, sideB),
  };
}
