/**
 * Teaching levels for the Skill Swap.
 * Formula: a member's level in tag t = percentile rank of their skill weight for t among all members
 *   of the university (members without t count as 0); members whose weight is 0 have no level.
 * Settings: swap.minTeachLevel (applied by the caller)
 * Spec: CLAUDE.md §8 F16 "Offers and wants"
 */
import { percentileRank } from '../stats/basic';

/** Each member's level in every tag they have, from the university's skill vectors. */
export function teachLevels(vectors: ReadonlyMap<string, Readonly<Record<string, number>>>): Map<string, Map<string, number>> {
  const tags = new Set<string>();
  for (const vector of vectors.values()) for (const [tag, weight] of Object.entries(vector)) if (weight > 0) tags.add(tag);
  const members = [...vectors.keys()];
  const levels = new Map<string, Map<string, number>>(members.map((member) => [member, new Map()]));
  for (const tag of tags) {
    const weights = members.map((member) => vectors.get(member)?.[tag] ?? 0);
    members.forEach((member, index) => {
      const weight = weights[index] ?? 0;
      if (weight > 0) levels.get(member)?.set(tag, percentileRank(weights, weight));
    });
  }
  return levels;
}
