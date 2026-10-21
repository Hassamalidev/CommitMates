/**
 * Alumni Quick Asks routing.
 * Formula: score = skillOverlap × (1 − load) × responsiveness, where skillOverlap is the cosine
 *   between the question's tags (weight 1 each) and the alumnus' skill vector, load = open routed
 *   questions ÷ `alumni.maxOpenPerAlumnus`, and responsiveness = answered ÷ routed over the recent
 *   window (0.5 with fewer than 3 routed, as the spec says). Role transition: from
 *   `alumni.transitionMonth` of year Y on, students who graduated before Y become alumni.
 * Settings: alumni.maxOpenPerAlumnus, alumni.transitionMonth (passed in)
 * Spec: CLAUDE.md §8 F20 "Roles", "Routing"
 */
import { cosine } from '../similarity/similarity';

/** Responsiveness of an alumnus with too little history to judge (§8 F20 step 3). */
export const NEUTRAL_RESPONSIVENESS = 0.5;
/** Routed questions below which responsiveness is not judged yet (§8 F20 step 3). */
export const MIN_ROUTED_FOR_RATE = 3;

export type AlumnusLoad = { open: number; routed: number; answered: number };

export function responsiveness(load: Pick<AlumnusLoad, 'routed' | 'answered'>): number {
  return load.routed < MIN_ROUTED_FOR_RATE ? NEUTRAL_RESPONSIVENESS : load.answered / load.routed;
}

/** One alumnus' score for a question; 0 when they are at their open-question cap. */
export function routeScore(questionTags: readonly string[], vector: Readonly<Record<string, number>>, load: AlumnusLoad, maxOpen: number): number {
  if (maxOpen <= 0 || load.open >= maxOpen) return 0;
  const overlap = cosine(Object.fromEntries(questionTags.map((tag) => [tag, 1])), vector);
  return overlap * (1 - load.open / maxOpen) * responsiveness(load);
}

/** The graduation year below which students count as alumni on `now` (§8 F20 "Roles"). */
export function alumniCutoffYear(now: Date, transitionMonth: number): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= transitionMonth ? year : year - 1;
}

export type AlumnusCandidate = AlumnusLoad & { id: string; vector: Readonly<Record<string, number>> };

/**
 * The `topK` alumni a question goes to (§8 F20 step 4): alumni at their cap are left out; the rest
 * are ordered by route score, then by availability ((1 − load) × responsiveness, so a question
 * whose tags nobody shares still reaches the alumni most likely to answer), then by id.
 */
export function rankAlumni(questionTags: readonly string[], candidates: readonly AlumnusCandidate[], maxOpen: number, topK: number): string[] {
  if (maxOpen <= 0 || topK <= 0) return [];
  return candidates
    .filter((candidate) => candidate.open < maxOpen)
    .map((candidate) => ({
      id: candidate.id,
      score: routeScore(questionTags, candidate.vector, candidate, maxOpen),
      availability: (1 - candidate.open / maxOpen) * responsiveness(candidate),
    }))
    .sort((a, b) => b.score - a.score || b.availability - a.availability || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, topK)
    .map((candidate) => candidate.id);
}
