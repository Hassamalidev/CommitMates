/**
 * Language shares and skill tags of a profile.
 * Formula: language share = Σ bytes of the language across non-fork repos / Σ all bytes;
 *            top six kept, the rest summed as "other";
 *          tag weight = repos whose dependencies carry the tag + repos with the tag as a topic,
 *            divided by the largest such weight; top twelve kept
 * Settings: none
 * Spec: CLAUDE.md §8 F1 steps 5–6
 */

/** Languages shown before the rest is grouped (§8 F1 step 5). */
export const MAX_LANGUAGES = 6;
/** Skill tags kept on a profile (§8 F1 step 6). */
export const MAX_SKILL_TAGS = 12;
/** Name of the bucket that collects the languages beyond the top ones. */
export const OTHER_LANGUAGE = 'other';

export type LanguageShare = { name: string; share: number };

export type RepoLanguages = { languages: Readonly<Record<string, number>>; isFork?: boolean };

/**
 * Share of code per language across a person's own repositories, largest first, with
 * everything past the top `limit` summed as "other". Empty when there is no code.
 */
export function languageShares(repos: readonly RepoLanguages[], limit: number = MAX_LANGUAGES): LanguageShare[] {
  const bytes = new Map<string, number>();
  for (const repo of repos) {
    if (repo.isFork) continue;
    for (const [name, size] of Object.entries(repo.languages)) {
      if (!(size > 0)) continue;
      bytes.set(name, (bytes.get(name) ?? 0) + size);
    }
  }
  let total = 0;
  for (const size of bytes.values()) total += size;
  if (total === 0) return [];

  // Ties are broken by name so the result does not depend on input order.
  const ranked = [...bytes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = ranked.slice(0, Math.max(0, limit)).map(([name, size]) => ({ name, share: size / total }));
  let rest = 0;
  for (const [, size] of ranked.slice(Math.max(0, limit))) rest += size;
  return rest > 0 ? [...top, { name: OTHER_LANGUAGE, share: rest / total }] : top;
}

export type SkillTag = { tag: string; weight: number };

export type RepoSkills = {
  /** Derived tags of the repository's dependencies; repeats are counted once per repository. */
  dependencyTags: readonly string[];
  topics: readonly string[];
};

/**
 * Skill tags verified from code: each tag weighs the number of repositories that depend
 * on something carrying it, plus one per repository that lists it as a topic. Weights are
 * scaled to [0, 1] by the largest; the top `limit` are kept.
 */
export function skillTags(repos: readonly RepoSkills[], limit: number = MAX_SKILL_TAGS): SkillTag[] {
  const weights = new Map<string, number>();
  const add = (tags: readonly string[]) => {
    for (const tag of new Set(tags)) {
      if (tag !== '') weights.set(tag, (weights.get(tag) ?? 0) + 1);
    }
  };
  for (const repo of repos) {
    add(repo.dependencyTags);
    add(repo.topics);
  }
  let max = 0;
  for (const weight of weights.values()) max = Math.max(max, weight);
  if (max === 0) return [];

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map(([tag, weight]) => ({ tag, weight: weight / max }));
}
