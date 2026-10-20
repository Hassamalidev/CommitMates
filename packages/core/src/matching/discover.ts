import { MATCH_MODES, sharedActiveWindow, type HourWindow, type MatchMode } from '@commitmates/algorithms';
import {
  NotFoundError,
  ValidationError,
  actOnSuggestion,
  getCachedAnalysis,
  getDb,
  getPersonaSnapshot,
  getProfileDetails,
  getSetting,
  getSkillVector,
  getUniversity,
  hasDeckToday,
  listDeck,
  listDepartments,
  listLikedToday,
  markSuggestionRequested,
  memberTopLanguage,
  putCachedAnalysis,
  type DeckCardRow,
  type DeckFilters,
  type SnapshotCompanion,
} from '@commitmates/db';
import { GitHubServerError, RateLimitError, SERVER_IDENTITY, githubFor, searchUsers, type SearchUser } from '@commitmates/github';
import { z } from 'zod';

import { createRequestInTx, loadRequestRules } from '../chat/service';
import { utcDay } from '../notifications/email';
import type { Member } from '../profiles/schemas';
import { hashParams } from '../tools/service';
import { campusUnlocks, type Unlock } from '../universities/campus';

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
/** Labels a card shows, strongest first (CLAUDE.md §8 F1 step 7). */
const MAX_LABELS = 3;
/** Tags a card shows. */
const CARD_TAGS = 6;
/** Longest tag accepted in the filter. */
const MAX_TAG_LENGTH = 64;

type DiscoverMember = Pick<Member, 'id' | 'login' | 'githubId' | 'universityId' | 'verified' | 'hasValidToken'>;

export type DiscoverQuery = { mode: MatchMode | null } & DeckFilters;

const modeSchema = z.enum(MATCH_MODES);
const yearSchema = z.coerce.number().int();

/**
 * Discover's address parameters (`?mode=&department=&from=&to=&tag=`), each read on its own so one
 * bad value does not drop the others.
 */
export function parseDiscoverQuery(raw: Readonly<Record<string, string | string[] | undefined>>): DiscoverQuery {
  const one = (key: string) => {
    const value = raw[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const mode = modeSchema.safeParse(one('mode'));
  const department = z.uuid().safeParse(one('department'));
  const from = yearSchema.safeParse(one('from'));
  const to = yearSchema.safeParse(one('to'));
  const tag = one('tag');
  return {
    mode: mode.success ? mode.data : null,
    departmentId: department.success ? department.data : undefined,
    yearFrom: from.success ? from.data : undefined,
    yearTo: to.success ? to.data : undefined,
    tag: tag !== undefined && tag.length <= MAX_TAG_LENGTH ? tag.toLowerCase() : undefined,
  };
}

const explanationSchema = z.object({
  sharedTags: z.array(z.string()).catch([]),
  coverage: z.array(z.string()).catch([]),
  sharedInterests: z.number().int().min(0).catch(0),
});

export type DeckCard = {
  suggestionId: string;
  mode: MatchMode;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  department: string | null;
  gradYear: number | null;
  tags: string[];
  labels: string[];
  companion: SnapshotCompanion;
  why: { sharedTags: string[]; coverage: string[]; sharedInterests: number; window: HourWindow | null };
};

/**
 * The card for one suggestion. A candidate without a persona snapshot yet gets the companion their
 * Dev Card would start from: seeded by their GitHub id, species from their top tag (§9.5 "Seeds").
 */
function toCard(row: DeckCardRow, ownHours: number[] | null): DeckCard {
  const why = explanationSchema.safeParse(row.explanation);
  const explanation = why.success ? why.data : { sharedTags: [], coverage: [], sharedInterests: 0 };
  return {
    suggestionId: row.suggestionId,
    mode: modeSchema.catch('explore').parse(row.mode),
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    department: row.department,
    gradYear: row.gradYear,
    tags: row.topTags.slice(0, CARD_TAGS),
    labels: row.labels.slice(0, MAX_LABELS),
    companion: row.companion ?? { seed: row.githubId, speciesKey: row.topTags[0] ?? row.login, paletteHex: null, stage: 0, traits: [] },
    why: { ...explanation, window: ownHours && row.hourHistUtc ? sharedActiveWindow(ownHours, row.hourHistUtc) : null },
  };
}

export type DiscoverView =
  | { status: 'locked'; unlock: Unlock }
  | {
      status: 'open';
      mode: MatchMode;
      /** No skill tags yet: an empty or brand-new GitHub. Explore is the default and goals are asked for. */
      emptyProfile: boolean;
      hasGoals: boolean;
      /** Whether tonight's decks included this member at all. */
      hasDeck: boolean;
      cards: DeckCard[];
      liked: DeckCard[];
      filters: DeckFilters;
      options: { departments: { id: string; name: string }[]; tags: string[]; years: { min: number; max: number } };
      firstMessage: { min: number; max: number };
    };

/** Everything the Discover page shows for one member (CLAUDE.md §8 F11 "UI"). */
export async function getDiscover(member: DiscoverMember, query: DiscoverQuery, now: Date = new Date()): Promise<DiscoverView> {
  if (!member.verified || member.universityId === null) throw new ValidationError('discover.verify_first', 'Verify your university first.');
  const { unlocks } = await campusUnlocks(member.universityId);
  const unlock = unlocks.find((entry) => entry.key === 'matching');
  if (!unlock) throw new NotFoundError('discover.unknown_unlock', 'Matching is not available.');
  if (!unlock.unlocked) return { status: 'locked', unlock };

  const day = utcDay(now);
  const [vector, details, own, hasDeck, departments, minChars, maxChars, maxAhead, maxBehind] = await Promise.all([
    getSkillVector(member.id),
    getProfileDetails(member.id),
    getPersonaSnapshot(member.id),
    hasDeckToday(member.id, day),
    listDepartments(member.universityId),
    getSetting('chat.minFirstMessageChars'),
    getSetting('chat.maxMessageChars'),
    getSetting('profile.gradYearMaxAhead'),
    getSetting('profile.gradYearMaxBehind'),
  ]);
  const emptyProfile = !vector || Object.keys(vector.vector).length === 0;
  const mode = query.mode ?? (emptyProfile ? 'explore' : 'study');
  const filters: DeckFilters = { departmentId: query.departmentId, yearFrom: query.yearFrom, yearTo: query.yearTo, tag: query.tag };
  const [all, filtered, liked] = await Promise.all([
    listDeck(member.id, day, mode, {}),
    listDeck(member.id, day, mode, filters),
    listLikedToday(member.id, day),
  ]);
  const ownHours = own?.hourHistUtc ?? null;
  const year = now.getUTCFullYear();
  return {
    status: 'open',
    mode,
    emptyProfile,
    hasGoals: (details?.learningGoals.length ?? 0) > 0,
    hasDeck,
    cards: filtered.map((row) => toCard(row, ownHours)),
    liked: liked.map((row) => toCard(row, ownHours)),
    filters,
    options: {
      departments,
      tags: [...new Set(all.flatMap((row) => row.topTags))].sort(),
      years: { min: year - maxBehind, max: year + maxAhead },
    },
    firstMessage: { min: minChars, max: maxChars },
  };
}

export const suggestionActionSchema = z.object({ suggestionId: z.uuid() });
export const suggestionRequestSchema = z.object({ suggestionId: z.uuid(), message: z.string() });

const gone = () => new NotFoundError('discover.gone', 'That suggestion is no longer in your deck.');

/** Like or Skip on one of the member's own suggestions (CLAUDE.md §8 F11 "UI"). */
export async function answerSuggestion(member: Pick<Member, 'id'>, action: 'liked' | 'skipped', raw: unknown, now: Date = new Date()): Promise<void> {
  const { suggestionId } = suggestionActionSchema.parse(raw);
  if (!(await actOnSuggestion(member.id, suggestionId, action, now))) throw gone();
}

/**
 * Request chat from a suggestion: the suggestion is marked requested and a message request is sent
 * with Discover as its context, in one transaction, so a refused request leaves the card as it was.
 */
export async function requestFromSuggestion(member: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<string> {
  const { suggestionId, message } = suggestionRequestSchema.parse(raw);
  const rules = await loadRequestRules();
  return getDb().transaction(async (tx) => {
    const candidate = await markSuggestionRequested(member.id, suggestionId, now, tx);
    if (candidate === null) throw gone();
    return createRequestInTx(tx, member.id, { toUserId: candidate, message, contextKind: 'discover', contextId: suggestionId }, now, rules);
  });
}

export type DevelopersLikeYou =
  | { status: 'ok'; language: string; country: string; people: SearchUser[] }
  | { status: 'no-language' }
  | { status: 'unavailable' };

const peopleSchema = z.array(z.object({ githubId: z.number(), login: z.string(), avatarUrl: z.string(), htmlUrl: z.string() }));

/** A value for a GitHub search qualifier: quotes would end the qualifier early, so they are dropped. */
const qualifier = (value: string) => `"${value.replace(/"/g, '')}"`;

/**
 * "Developers like you on GitHub" for Discover's cold start (§8 F11 "UI"): a GitHub user search by the
 * member's top language and their university's country, view-only. The list describes people who are
 * not members, so it is cached no longer than `privacy.nonUserRawTtlHours` and filed under the
 * member's login, which their account deletion clears.
 */
export async function developersLikeYou(member: DiscoverMember, now: Date = new Date()): Promise<DevelopersLikeYou> {
  if (member.githubId === null || member.login === null || member.universityId === null) return { status: 'no-language' };
  const [language, university] = await Promise.all([memberTopLanguage(member.githubId), getUniversity(member.universityId)]);
  if (language === null || !university) return { status: 'no-language' };
  const key = { kind: 'developers_like_you', subjectKey: member.login.toLowerCase(), paramsHash: hashParams({ language, country: university.country }) };
  const cached = await getCachedAnalysis(key, now);
  const parsed = cached ? peopleSchema.safeParse(cached.result) : null;
  if (parsed?.success) return { status: 'ok', language, country: university.country, people: parsed.data };

  const [size, searchTtl, rawTtl] = await Promise.all([
    getSetting('matching.coldStartListSize'),
    getSetting('cache.searchTtlHours'),
    getSetting('privacy.nonUserRawTtlHours'),
  ]);
  const client = githubFor(member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY);
  let found: SearchUser[];
  try {
    // One extra, because the member may be among the results.
    found = await searchUsers(client, `language:${qualifier(language)} location:${qualifier(university.country)}`, { perPage: size + 1 });
  } catch (error) {
    // A view-only extra: when GitHub is slow or out of budget, the page says so instead of failing.
    if (error instanceof RateLimitError || error instanceof GitHubServerError) return { status: 'unavailable' };
    throw error;
  }
  const people = found.filter((person) => person.githubId !== member.githubId).slice(0, size);
  await putCachedAnalysis({
    ...key,
    result: people,
    isMemberSubject: false,
    computedAt: now,
    expiresAt: new Date(now.getTime() + Math.min(searchTtl, rawTtl) * MS_PER_HOUR),
  });
  return { status: 'ok', language, country: university.country, people };
}
