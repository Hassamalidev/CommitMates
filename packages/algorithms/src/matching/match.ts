/**
 * Partner matching within a university.
 * Formula:
 *   sim  = cosine(vec_u, vec_c)
 *   int  = jaccard(interests_u, interests_c)
 *   comp = Σ_g min(goal_u[g], vec_c_n[g]) / Σ_g goal_u[g], goals weighted 1, vec_c_n = vec_c / max(vec_c);
 *          without goals, the university's top tags minus the member's own top tags stand in
 *   score_mode = w_sim·sim + w_int·int + w_comp·comp
 *   decks: members in seeded random order; the three modes take turns picking their best remaining
 *          candidate, each candidate at most once per member per day and at most `maxImpressions` times
 *          across all decks
 * Settings: matching.weights, matching.deckSize, matching.maxDailyImpressions (passed in)
 * Spec: CLAUDE.md §8 F11 "Scoring", "Deck", "Explanations"
 */

import { cosine, jaccard, type SparseVector } from '../similarity/similarity';

export const MATCH_MODES = ['study', 'teammate', 'explore'] as const; // allowed-literal: the match_mode enum values (CLAUDE.md §7.6)
export type MatchMode = (typeof MATCH_MODES)[number];
export type ModeWeights = { sim: number; int: number; comp: number };
export type MatchComponents = ModeWeights;

export type MatchProfile = {
  id: string;
  vector: SparseVector;
  topTags: readonly string[];
  interests: readonly string[];
  /** Learning goals, or the gaps that stand in for them. */
  goals: readonly string[];
};

/** Explanation lines are template keys with real values, never generated text (§2.1). */
export type MatchExplanation = { sharedTags: string[]; coverage: string[]; sharedInterests: number };

export type DeckEntry = {
  userId: string;
  candidateId: string;
  mode: MatchMode;
  score: number;
  components: MatchComponents;
  explanation: MatchExplanation;
};

/** At most this many items in each explanation list. */
const EXPLANATION_ITEMS = 3;

/** Scales a vector so its largest weight is 1. */
export function maxNormalize(vector: SparseVector): Record<string, number> {
  const max = Math.max(0, ...Object.values(vector));
  if (max === 0) return {};
  return Object.fromEntries(Object.entries(vector).map(([key, value]) => [key, value / max]));
}

/** How much of a member's goals a candidate covers, in [0, 1]; 0 without goals. */
export function complementarity(goals: readonly string[], candidate: SparseVector): number {
  const unique = [...new Set(goals)];
  if (unique.length === 0) return 0;
  const normalized = maxNormalize(candidate);
  return unique.reduce((sum, goal) => sum + Math.min(1, normalized[goal] ?? 0), 0) / unique.length;
}

/** The university's strongest tags the member lacks, standing in for goals they did not set. */
export function universityGaps(universityTopTags: readonly string[], memberTopTags: readonly string[]): string[] {
  const own = new Set(memberTopTags);
  return universityTopTags.filter((tag) => !own.has(tag));
}

export function matchComponents(user: MatchProfile, candidate: MatchProfile): MatchComponents {
  return {
    sim: cosine(user.vector, candidate.vector),
    int: jaccard(user.interests, candidate.interests),
    comp: complementarity(user.goals, candidate.vector),
  };
}

export function modeScore(components: MatchComponents, weights: ModeWeights): number {
  return weights.sim * components.sim + weights.int * components.int + weights.comp * components.comp;
}

/** Whether two members share anything worth scoring: a tag, an interest, or a goal the candidate covers. */
export function sharesSignal(user: MatchProfile, candidate: MatchProfile): boolean {
  const tags = new Set(Object.keys(user.vector).filter((tag) => (user.vector[tag] ?? 0) > 0));
  if (Object.entries(candidate.vector).some(([tag, weight]) => weight > 0 && tags.has(tag))) return true;
  const interests = new Set(user.interests);
  if (candidate.interests.some((interest) => interests.has(interest))) return true;
  return user.goals.some((goal) => (candidate.vector[goal] ?? 0) > 0);
}

export function explainMatch(user: MatchProfile, candidate: MatchProfile): MatchExplanation {
  const theirs = new Set(candidate.topTags);
  const normalized = maxNormalize(candidate.vector);
  const interests = new Set(candidate.interests);
  return {
    sharedTags: user.topTags.filter((tag) => theirs.has(tag)).slice(0, EXPLANATION_ITEMS),
    coverage: [...new Set(user.goals)]
      .filter((goal) => (normalized[goal] ?? 0) > 0)
      .sort((a, b) => (normalized[b] ?? 0) - (normalized[a] ?? 0) || a.localeCompare(b))
      .slice(0, EXPLANATION_ITEMS),
    sharedInterests: user.interests.filter((interest) => interests.has(interest)).length,
  };
}

export type DeckInput = {
  /** Members in the order they are served; shuffle it with a seeded RNG for fairness. */
  order: readonly MatchProfile[];
  weights: Readonly<Record<MatchMode, ModeWeights>>;
  deckSize: number;
  maxImpressions: number;
  /** Pairs that must never meet: blocks, connections, hidden or ghost members (checked both ways by the caller). */
  excluded: (userId: string, candidateId: string) => boolean;
};

/** Every member's daily decks for the three modes (§8 F11 "Deck"). */
export function buildDecks(input: DeckInput): DeckEntry[] {
  const impressions = new Map<string, number>();
  const entries: DeckEntry[] = [];
  for (const user of input.order) {
    const candidates = input.order
      .filter((candidate) => candidate.id !== user.id && !input.excluded(user.id, candidate.id) && sharesSignal(user, candidate))
      .map((candidate) => ({ candidate, components: matchComponents(user, candidate) }));
    // A candidate appears once per member per day, in one mode. The modes take turns picking their
    // best remaining candidate, so the first mode does not take everyone.
    const ranked = MATCH_MODES.map((mode) => ({
      mode,
      queue: candidates
        .map((entry) => ({ ...entry, score: modeScore(entry.components, input.weights[mode]) }))
        .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id)),
      taken: 0,
    }));
    const shown = new Set<string>();
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const deck of ranked) {
        if (deck.taken >= input.deckSize) continue;
        let next = deck.queue.shift();
        while (next && (shown.has(next.candidate.id) || (impressions.get(next.candidate.id) ?? 0) >= input.maxImpressions)) next = deck.queue.shift();
        if (!next) continue;
        const { candidate, components, score } = next;
        entries.push({ userId: user.id, candidateId: candidate.id, mode: deck.mode, score, components, explanation: explainMatch(user, candidate) });
        impressions.set(candidate.id, (impressions.get(candidate.id) ?? 0) + 1);
        shown.add(candidate.id);
        deck.taken += 1;
        progressed = true;
      }
    }
  }
  return entries;
}
