import { createHash } from 'node:crypto';

import { bm25Index, bm25Scores, bm25Tokens, yake } from '@commitmates/algorithms';
import { getDb, getSetting, schema } from '@commitmates/db';
import { SERVER_IDENTITY, fetchReadme, githubFor, searchRepositories, type SearchRepo } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { loadStopwords } from '@commitmates/sources';

import { dayBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { fypInputSchema, fypResultSchema, type FypInput, type FypResult } from './schemas';

/** The steps `fyp_check` reports, in order. */
export const FYP_STEPS = { keyphrases: 'keyphrases', searching: 'searching', reading: 'reading', comparing: 'comparing' } as const;

/** README characters compared (§8 F9 step 3). */
const MAX_README_CHARS = 20_000;
/** Keyphrases combined in the first search, and the pairs searched after it (§8 F9 step 2). */
const TOGETHER = 3;
/** Closest projects whose keyphrases decide what is unique to the idea (§8 F9 step 5). */
const UNIQUE_AGAINST = 5;
/** Normalized Levenshtein similarity above which two keyphrases are near-duplicates (§8 F9, reference YAKE). */
const DEDUP_THRESHOLD = 0.8; // allowed-literal: from the reference implementation (§8 F9)
/** Similarity is reported in percent. */
const PERCENT = 100;
/** Characters of a SHA-256 digest used to key an idea. */
const KEY_LENGTH = 16;
/** GitHub's largest search page. */
const SEARCH_PAGE = 100;
/** Time kept in hand before the deadline for comparing and storing. */
const DEADLINE_MARGIN_MS = 4000;

const ideaText = (input: FypInput) => `${input.title}\n${input.description}`;
const ideaKey = (input: FypInput) =>
  createHash('sha256').update(ideaText(input).toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, KEY_LENGTH);

export const fypTool: ToolDefinition<FypInput> = {
  slug: 'fyp-check',
  jobType: 'fyp_check',
  cacheKind: 'fyp',
  input: fypInputSchema,
  subjectKey: ideaKey,
  idempotencyKey: (input, now) => `fyp:${ideaKey(input)}:${dayBucket(now)}`,
  ttlSetting: 'cache.searchTtlHours',
};

/**
 * The language of a text, as the stopword list it shares the most words with; English when
 * nothing matches. Data-driven: the lists come from stopwords-iso.
 */
export async function detectLanguage(text: string): Promise<{ language: string; stopwords: Set<string> }> {
  const words = new Set(text.toLowerCase().match(/[\p{L}']+/gu) ?? []);
  const rows = await getDb().select({ language: schema.stopwords.language, words: schema.stopwords.words }).from(schema.stopwords);
  let best = { language: 'en', overlap: 0, words: [] as string[] };
  for (const row of rows) {
    let overlap = 0;
    for (const word of row.words) if (words.has(word)) overlap += 1;
    if (overlap > best.overlap) best = { language: row.language, overlap, words: row.words };
  }
  if (best.overlap === 0) return { language: 'en', stopwords: await loadStopwords('en') };
  return { language: best.language, stopwords: new Set(best.words) };
}

/**
 * Keyphrases of a short text with YAKE (§8 F9 step 1), in the text's language, capped at
 * `fyp.yake.maxKeyphrases` phrases of up to `fyp.yake.ngramMax` words. Shared with Alumni Quick Asks.
 */
export async function extractKeyphrases(text: string): Promise<string[]> {
  const [maxKeyphrases, ngramMax] = await Promise.all([getSetting('fyp.yake.maxKeyphrases'), getSetting('fyp.yake.ngramMax')]);
  const { stopwords } = await detectLanguage(text);
  return yake(text, { stopwords, ngramMax, top: maxKeyphrases, dedupThreshold: DEDUP_THRESHOLD }).map((entry) => entry.keyphrase);
}

const quote = (phrase: string) => `"${phrase.replace(/"/g, '')}"`;

/**
 * How close existing projects are to a final-year-project idea (CLAUDE.md §8 F9): keyphrases
 * with YAKE, GitHub searches built from them, and the READMEs reranked with BM25.
 */
export const fypCheckJob: JobHandler<FypInput> = {
  type: 'fyp_check',
  schema: fypInputSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(input, ctx) {
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const text = ideaText(input);

    await ctx.progress({ step: FYP_STEPS.keyphrases });
    const [maxKeyphrases, ngramMax, topN, bands, k1, b] = await Promise.all([
      getSetting('fyp.yake.maxKeyphrases'),
      getSetting('fyp.yake.ngramMax'),
      getSetting('fyp.searchTopN'),
      getSetting('fyp.bands'),
      getSetting('ir.bm25.k1'),
      getSetting('ir.bm25.b'),
    ]);
    const { language, stopwords } = await detectLanguage(text);
    const extract = (body: string) => yake(body, { stopwords, ngramMax, top: maxKeyphrases, dedupThreshold: DEDUP_THRESHOLD }).map((entry) => entry.keyphrase);
    const keyphrases = extract(text);

    await ctx.progress({ step: FYP_STEPS.searching });
    const [k1st, k2nd, k3rd] = keyphrases;
    const queries = [
      keyphrases.slice(0, TOGETHER).map(quote).join(' '),
      ...(k1st && k2nd ? [`${quote(k1st)} ${quote(k2nd)}`] : []),
      ...(k1st && k3rd ? [`${quote(k1st)} ${quote(k3rd)}`] : []),
    ].filter((query) => query !== '');
    const found = new Map<number, SearchRepo>();
    for (const query of [...new Set(queries)]) {
      if (found.size >= topN) break;
      const { repos } = await searchRepositories(client, `${query} in:name,description,readme`, { perPage: Math.min(SEARCH_PAGE, topN), deadline: ctx.deadline });
      for (const repo of repos) if (found.size < topN && !found.has(repo.githubId)) found.set(repo.githubId, repo);
    }

    await ctx.progress({ step: FYP_STEPS.reading, message: `Reading ${found.size} projects` });
    const readmes: { repo: SearchRepo; readme: string }[] = [];
    for (const repo of found.values()) {
      if (Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) return { kind: 'continue', payload: input };
      const [owner = '', name = ''] = repo.fullName.split('/');
      const readme = (await fetchReadme(client, owner, name, { deadline: ctx.deadline })) ?? '';
      readmes.push({ repo, readme: `${repo.name}\n${repo.description ?? ''}\n${readme}`.slice(0, MAX_README_CHARS) });
    }

    await ctx.progress({ step: FYP_STEPS.comparing });
    const query = bm25Tokens(text, stopwords);
    // The idea is part of the corpus so its own score is the 100 % mark (§8 F9 step 4).
    const index = bm25Index([...readmes.map((entry) => bm25Tokens(entry.readme, stopwords)), query]);
    const scores = bm25Scores(index, query, { k1, b });
    const selfScore = scores.at(-1) ?? 0;
    const [relatedAt = 0, veryAt = 0] = bands;
    const ideaPhrases = new Map(keyphrases.map((phrase) => [phrase.toLowerCase(), phrase]));

    const results: FypResult['results'] = readmes
      .map((entry, index) => {
        const similarity = selfScore === 0 ? 0 : Math.min(PERCENT, (PERCENT * (scores[index] ?? 0)) / selfScore);
        const theirs = new Set(extract(entry.readme).map((phrase) => phrase.toLowerCase()));
        return {
          fullName: entry.repo.fullName,
          description: entry.repo.description,
          stars: entry.repo.stars,
          similarity: Math.round(similarity),
          band: similarity >= veryAt ? ('very-similar' as const) : similarity >= relatedAt ? ('related' as const) : ('loose' as const),
          sharedKeyphrases: [...ideaPhrases].filter(([lower]) => theirs.has(lower)).map(([, phrase]) => phrase),
        };
      })
      .sort((a, b) => b.similarity - a.similarity || a.fullName.localeCompare(b.fullName));

    const closest = new Set(results.slice(0, UNIQUE_AGAINST).map((result) => result.fullName));
    const closestText = readmes.filter((entry) => closest.has(entry.repo.fullName)).map((entry) => entry.readme.toLowerCase());
    const unique = keyphrases.filter((phrase) => !closestText.some((readme) => readme.includes(phrase.toLowerCase())));

    const result = fypResultSchema.parse({ keyphrases, language, results, unique });
    const resultRef = await storeToolResult(fypTool, input, result, { isMemberSubject: false, now: ctx.now() });
    return { kind: 'done', resultRef };
  },
};
