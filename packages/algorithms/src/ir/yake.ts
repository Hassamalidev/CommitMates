/**
 * YAKE! keyword extraction (Campos et al., "YAKE! Keyword extraction from single documents
 * using multiple local features", Information Sciences 509, 2020), following the reference
 * implementation's scoring (yake 0.4.8) term by term.
 * Formula: per term, WCase = max(TF_upper, TF_name) / (1 + ln TF); WPos = ln(ln(3 + median sentence));
 *          WFreq = TF / (mean TF + σ TF); WRel = (0.5 + DL/WL · TF/maxTF) + (0.5 + DR/WR · TF/maxTF);
 *          WSpread = sentences with the term / sentences; H = WPos·WRel / (WCase + WFreq/WRel + WSpread/WRel);
 *          per candidate (n-gram up to `ngramMax`, not starting or ending with a stopword),
 *          S = Π H / (TF · (1 + Σ H)) with stopwords inside weighted by their bigram probabilities;
 *          lower is better; near-duplicates (normalized Levenshtein similarity above the
 *          threshold) are dropped
 * Settings: fyp.yake.maxKeyphrases, fyp.yake.ngramMax (passed in); stopwords from the synced dataset
 * Spec: CLAUDE.md §8 F9 step 1
 */

import { median, standardDeviation, mean } from '../stats/basic';

/** ASCII punctuation, as Python's `string.punctuation` (the reference's "exclude" set). */
const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
/** Tags whose terms take no part in co-occurrence: unparsable ("u") and numbers ("d"). */
const DISCARDED_TAGS = new Set(['u', 'd']);
/** Terms shorter than this (after removing punctuation) count as stopwords. */
const MIN_TERM_LENGTH = 3;
/** The reference adds 3 before taking the double logarithm of the median sentence. */
const POSITION_OFFSET = 3;
/** Co-occurrence window, in words (the reference default). */
const WINDOW = 1;
/** Plural trimming applies to words longer than this. */
const PLURAL_MIN_LENGTH = 3;
/** What Python's `float()` accepts as a number, which the reference uses to tag numbers. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** The words Python's `float()` also accepts. */
const PYTHON_FLOAT_WORDS = new Set(['nan', 'inf', 'infinity', '+inf', '-inf', '+infinity', '-infinity']);

export type Keyphrase = { keyphrase: string; score: number };

export type YakeOptions = {
  stopwords: ReadonlySet<string>;
  /** Longest keyphrase in words. */
  ngramMax: number;
  /** Keyphrases returned. */
  top: number;
  /** Candidates more similar than this to a kept one are dropped (normalized Levenshtein similarity). */
  dedupThreshold: number;
};

type Term = {
  id: number;
  stopword: boolean;
  tf: number;
  tfUpper: number;
  tfName: number;
  /** Sentence index → number of occurrences in it. */
  sentences: Map<number, number>;
  h: number;
};

type Entry = { tag: string; word: string; term: Term };

type Candidate = { keyphrase: string; tags: Set<string>; terms: Term[]; tf: number; edgeStopwords: boolean; h: number };

/** Lines that start with a capital letter begin a new paragraph, as in the reference's pre-filter. */
function preFilter(text: string): string {
  return text
    .split('\n')
    .map((part) => (/^\s*[A-Z]/.test(part) ? '\n\n' : ' ') + part.replace(/\t/g, ' '))
    .join('');
}

/** Sentences: blank lines, and terminal punctuation followed by space and a capital, digit or quote. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((block) => block.split(/(?<=[.!?…])\s+(?=["'“‘([]?[\p{Lu}\p{N}])/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

const TOKEN = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

/** Words and single punctuation marks, with contractions split off as the reference does ("don't" → "do", "n't"). */
export function tokenize(sentence: string): string[] {
  const tokens: string[] = [];
  for (const raw of sentence.match(TOKEN) ?? []) {
    const word = raw.replace(/’/g, "'");
    const [, negated, negation] = /^(.+)(n't)$/i.exec(word) ?? [];
    const [, base, clitic] = /^(.+)('(?:s|re|ve|ll|d|m))$/i.exec(word) ?? [];
    if (negated && negation) tokens.push(negated, negation);
    else if (base && clitic) tokens.push(base, clitic);
    else tokens.push(word);
  }
  // The reference drops clitics like "'s" and empty tokens.
  return tokens.filter((token) => token.length > 0 && !(token.startsWith("'") && token.length > 1));
}

const isPunctuation = (word: string) => Array.from(word).every((character) => PUNCTUATION.has(character));
const isUpper = (character: string) => character !== character.toLowerCase() && character === character.toUpperCase();
const isDigit = (character: string) => /\p{Nd}/u.test(character);
const isAlpha = (character: string) => /\p{L}/u.test(character);

/** The reference's word tag: "d" number, "u" unparsable, "a" acronym, "n" proper name, "p" plain. */
export function wordTag(word: string, position: number): string {
  const plain = word.replace(/,/g, '');
  if (NUMBER.test(plain) || PYTHON_FLOAT_WORDS.has(plain.toLowerCase())) return 'd';
  const characters = Array.from(word);
  const digits = characters.filter(isDigit).length;
  const letters = characters.filter(isAlpha).length;
  const punctuation = characters.filter((character) => PUNCTUATION.has(character)).length;
  if ((digits > 0 && letters > 0) || (digits === 0 && letters === 0) || punctuation > 1) return 'u';
  const uppers = characters.filter(isUpper).length;
  if (characters.length === uppers) return 'a';
  if (uppers === 1 && characters.length > 1 && isUpper(characters[0] ?? '') && position > 0) return 'n';
  return 'p';
}

/** Normalized Levenshtein similarity: 1 − distance / longer length. */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return 1 - (previous[b.length] ?? longer) / longer;
}

/** Extracts the `top` keyphrases of a text, best (lowest score) first. */
export function yake(text: string, options: YakeOptions): Keyphrase[] {
  if (text.trim() === '') return [];
  const sentences = splitSentences(preFilter(text.replace(/\n\t/g, ' '))).map(tokenize).filter((tokens) => tokens.length > 0);
  const terms = new Map<string, Term>();
  const edges = new Map<number, Map<number, number>>();
  const candidates = new Map<string, Candidate>();

  const termFor = (word: string): Term => {
    let unique = word.toLowerCase();
    const plainStopword = options.stopwords.has(unique);
    if (unique.endsWith('s') && unique.length > PLURAL_MIN_LENGTH) unique = unique.slice(0, -1);
    const known = terms.get(unique);
    if (known) return known;
    const bare = Array.from(unique).filter((character) => !PUNCTUATION.has(character)).join('');
    const term: Term = {
      id: terms.size,
      stopword: plainStopword || options.stopwords.has(unique) || bare.length < MIN_TERM_LENGTH,
      tf: 0,
      tfUpper: 0,
      tfName: 0,
      sentences: new Map(),
      h: 0,
    };
    terms.set(unique, term);
    return term;
  };
  const addCandidate = (entries: readonly Entry[]) => {
    const keyphrase = entries.map((entry) => entry.word).join(' ');
    const key = keyphrase.toLowerCase();
    const tags = entries.map((entry) => entry.tag).join('');
    const existing = candidates.get(key);
    if (existing) {
      existing.tags.add(tags);
      existing.tf += 1;
      return;
    }
    const termList = entries.map((entry) => entry.term);
    candidates.set(key, {
      keyphrase,
      tags: new Set([tags]),
      terms: termList,
      tf: 1,
      edgeStopwords: Boolean(termList[0]?.stopword) || Boolean(termList.at(-1)?.stopword),
      h: 1,
    });
  };

  sentences.forEach((sentence, sentenceId) => {
    let block: Entry[] = [];
    sentence.forEach((word, position) => {
      if (isPunctuation(word)) {
        block = [];
        return;
      }
      const tag = wordTag(word, position);
      const term = termFor(word);
      term.tf += 1;
      term.sentences.set(sentenceId, (term.sentences.get(sentenceId) ?? 0) + 1);
      if (tag === 'a') term.tfUpper += 1;
      if (tag === 'n') term.tfName += 1;

      if (!DISCARDED_TAGS.has(tag)) {
        for (const previous of block.slice(Math.max(0, block.length - WINDOW))) {
          if (DISCARDED_TAGS.has(previous.tag)) continue;
          const out = edges.get(previous.term.id) ?? new Map<number, number>();
          out.set(term.id, (out.get(term.id) ?? 0) + 1);
          edges.set(previous.term.id, out);
        }
      }
      const entry: Entry = { tag, word, term };
      const grown: Entry[] = [entry];
      addCandidate(grown);
      for (const previous of block.slice(Math.max(0, block.length - (options.ngramMax - 1))).reverse()) {
        grown.unshift(previous);
        addCandidate(grown);
      }
      block.push(entry);
    });
  });

  const allTerms = [...terms.values()];
  const valid = allTerms.filter((term) => !term.stopword).map((term) => term.tf);
  if (valid.length === 0) return [];
  const avgTF = mean(valid);
  const stdTF = standardDeviation(valid);
  const maxTF = Math.max(...allTerms.map((term) => term.tf));

  // In-degree and in-weight of each term in the co-occurrence graph.
  const inDegree = new Map<number, number>();
  const inWeight = new Map<number, number>();
  for (const out of edges.values()) {
    for (const [to, weight] of out) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
      inWeight.set(to, (inWeight.get(to) ?? 0) + weight);
    }
  }
  for (const term of allTerms) {
    const out = edges.get(term.id);
    const outDegree = out?.size ?? 0;
    const outWeight = out ? [...out.values()].reduce((total, weight) => total + weight, 0) : 0;
    const pwl = (inWeight.get(term.id) ?? 0) === 0 ? 0 : (inDegree.get(term.id) ?? 0) / (inWeight.get(term.id) ?? 1);
    const pwr = outWeight === 0 ? 0 : outDegree / outWeight;
    const relatedness = 0.5 + pwl * (term.tf / maxTF) + (0.5 + pwr * (term.tf / maxTF));
    const frequency = term.tf / (avgTF + stdTF);
    const spread = term.sentences.size / sentences.length;
    const casing = Math.max(term.tfUpper, term.tfName) / (1 + Math.log(term.tf));
    const position = Math.log(Math.log(POSITION_OFFSET + median([...term.sentences.keys()])));
    term.h = (position * relatedness) / (casing + frequency / relatedness + spread / relatedness);
  }

  const edgeWeight = (from: Term | undefined, to: Term | undefined) => (from && to ? (edges.get(from.id)?.get(to.id) ?? 0) : 0);
  const scored = [...candidates.values()].filter(
    (candidate) => !candidate.edgeStopwords && [...candidate.tags].some((tags) => !tags.includes('u') && !tags.includes('d')),
  );
  for (const candidate of scored) {
    let sum = 0;
    let product = 1;
    candidate.terms.forEach((term, index) => {
      if (!term.stopword) {
        sum += term.h;
        product *= term.h;
        return;
      }
      // A stopword inside a phrase weighs by how often it joins its neighbours.
      const left = candidate.terms[index - 1];
      const right = candidate.terms[index + 1];
      const p1 = left && left.tf > 0 ? edgeWeight(left, term) / left.tf : 0;
      const p2 = right && right.tf > 0 ? edgeWeight(term, right) / right.tf : 0;
      const probability = p1 * p2;
      product *= 1 + (1 - probability);
      sum -= 1 - probability;
    });
    candidate.h = product / ((sum + 1) * candidate.tf);
  }

  const result: Candidate[] = [];
  for (const candidate of scored.sort((a, b) => a.h - b.h)) {
    const key = candidate.keyphrase.toLowerCase();
    if (result.some((kept) => levenshteinSimilarity(key, kept.keyphrase.toLowerCase()) > options.dedupThreshold)) continue;
    result.push(candidate);
    if (result.length === options.top) break;
  }
  return result.map((candidate) => ({ keyphrase: candidate.keyphrase, score: candidate.h }));
}
