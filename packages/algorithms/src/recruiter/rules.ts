/**
 * Recruiter-Ready Score: a weighted rule engine with partial credit.
 * Formula: each rule gives a credit in [0, 1]; score = round(100 × Σ w·c / Σ w) over the rules
 *          that apply and have a positive weight (see the table in the spec for each rule)
 * Settings: recruiter.weights, recruiter.pinned.min, recruiter.pinned.max, recruiter.readme.minChars,
 *           recruiter.profileReadme.minChars, recruiter.minMessageTokens, persona.marathoner.activeDayShare
 * Spec: CLAUDE.md §8 F3 "Rules", "Score"
 */

import { isInformativeMessage } from './text';

export type RecruiterRuleKey =
  | 'profileReadme'
  | 'pinnedCount'
  | 'pinnedReadme'
  | 'pinnedDemo'
  | 'pinnedLicense'
  | 'pinnedDescription'
  | 'pinnedTopics'
  | 'commitMessages'
  | 'unfinishedRatio'
  | 'languageMatch'
  | 'activityConsistency';

/** Order in which rules are listed. */
export const RECRUITER_RULES: readonly RecruiterRuleKey[] = [
  'profileReadme',
  'pinnedCount',
  'pinnedReadme',
  'pinnedDemo',
  'pinnedLicense',
  'pinnedDescription',
  'pinnedTopics',
  'commitMessages',
  'unfinishedRatio',
  'languageMatch',
  'activityConsistency',
];

/** A credit of at least this is a pass; above zero but below it is partial. */
export const PASS_CREDIT = 1;
/** Credit for exactly one pinned repository (§8 F3 `pinnedCount`). */
export const SINGLE_PIN_CREDIT = 0.5;
/** Unfinished score at which a repository counts as unfinished (§8 F3 `unfinishedRatio`). */
export const UNFINISHED_AT = 0.5;
/** Claimed skills listed by name when they were not found. */
export const MAX_MISSING_SKILLS = 5;

export type ShowcaseRepo = {
  readmeChars: number;
  hasDemo: boolean;
  hasLicense: boolean;
  hasDescription: boolean;
  hasTopics: boolean;
};

export type RecruiterFacts = {
  /** Characters of the profile README (`<login>/<login>`); `null` when there is none. */
  profileReadmeChars: number | null;
  pinnedCount: number;
  /** The pinned repositories, or the top ones by stars when nothing is pinned. */
  showcase: readonly ShowcaseRepo[];
  showcaseSource: 'pinned' | 'top';
  commitMessages: readonly string[];
  genericMessages: ReadonlySet<string>;
  /** Unfinished scores of the repositories that could be examined (`null` ones are skipped). */
  unfinishedScores: readonly (number | null)[];
  /** Normalized claimed skills; empty when none were given. */
  resumeSkills: readonly string[];
  /** Normalized languages and skill tags verified from code. */
  verifiedSkills: ReadonlySet<string>;
  activeDayShare: number;
};

export type RecruiterSettings = {
  weights: Readonly<Record<string, number>>;
  pinnedMin: number;
  pinnedMax: number;
  readmeMinChars: number;
  profileReadmeMinChars: number;
  minMessageTokens: number;
  activeDayTarget: number;
};

export type RuleEvidence = Readonly<Record<string, number | string | boolean | null | readonly string[]>>;

export type RuleResult = {
  key: RecruiterRuleKey;
  applicable: boolean;
  credit: number;
  weight: number;
  status: 'pass' | 'partial' | 'fail' | 'not-applicable';
  evidence: RuleEvidence;
};

const share = (met: number, total: number) => (total === 0 ? 0 : met / total);

function showcaseRule(facts: RecruiterFacts, test: (repo: ShowcaseRepo) => boolean) {
  const met = facts.showcase.filter(test).length;
  return {
    applicable: facts.showcase.length > 0,
    credit: share(met, facts.showcase.length),
    evidence: { met, total: facts.showcase.length, source: facts.showcaseSource },
  };
}

type RuleOutcome = { applicable: boolean; credit: number; evidence: RuleEvidence };

function evaluate(key: RecruiterRuleKey, facts: RecruiterFacts, settings: RecruiterSettings): RuleOutcome {
  switch (key) {
    case 'profileReadme': {
      const chars = facts.profileReadmeChars;
      return {
        applicable: true,
        credit: chars !== null && chars >= settings.profileReadmeMinChars ? 1 : 0,
        evidence: { chars, min: settings.profileReadmeMinChars },
      };
    }
    case 'pinnedCount': {
      const count = facts.pinnedCount;
      const inRange = count >= settings.pinnedMin && count <= settings.pinnedMax;
      return {
        applicable: true,
        credit: inRange ? 1 : count === 1 ? SINGLE_PIN_CREDIT : 0,
        evidence: { count, min: settings.pinnedMin, max: settings.pinnedMax },
      };
    }
    case 'pinnedReadme': {
      const rule = showcaseRule(facts, (repo) => repo.readmeChars >= settings.readmeMinChars);
      return { ...rule, evidence: { ...rule.evidence, min: settings.readmeMinChars } };
    }
    case 'pinnedDemo':
      return showcaseRule(facts, (repo) => repo.hasDemo);
    case 'pinnedLicense':
      return showcaseRule(facts, (repo) => repo.hasLicense);
    case 'pinnedDescription':
      return showcaseRule(facts, (repo) => repo.hasDescription);
    case 'pinnedTopics':
      return showcaseRule(facts, (repo) => repo.hasTopics);
    case 'commitMessages': {
      const informative = facts.commitMessages.filter((message) =>
        isInformativeMessage(message, settings.minMessageTokens, facts.genericMessages),
      ).length;
      return {
        applicable: facts.commitMessages.length > 0,
        credit: share(informative, facts.commitMessages.length),
        evidence: { informative, total: facts.commitMessages.length },
      };
    }
    case 'unfinishedRatio': {
      const examined = facts.unfinishedScores.filter((score): score is number => score !== null);
      const unfinished = examined.filter((score) => score >= UNFINISHED_AT).length;
      return {
        applicable: examined.length > 0,
        credit: 1 - share(unfinished, examined.length),
        evidence: { unfinished, examined: examined.length },
      };
    }
    case 'languageMatch': {
      const claimed = [...new Set(facts.resumeSkills)];
      const missing = claimed.filter((skill) => !facts.verifiedSkills.has(skill));
      return {
        applicable: claimed.length > 0,
        credit: share(claimed.length - missing.length, claimed.length),
        evidence: { matched: claimed.length - missing.length, total: claimed.length, missing: missing.slice(0, MAX_MISSING_SKILLS) },
      };
    }
    case 'activityConsistency':
      return {
        applicable: true,
        credit: settings.activeDayTarget > 0 ? Math.min(1, facts.activeDayShare / settings.activeDayTarget) : 0,
        evidence: { activeDayShare: facts.activeDayShare, target: settings.activeDayTarget },
      };
  }
}

const statusOf = (applicable: boolean, credit: number): RuleResult['status'] =>
  !applicable ? 'not-applicable' : credit >= PASS_CREDIT ? 'pass' : credit > 0 ? 'partial' : 'fail';

/** Every rule with its credit, weight, status and evidence, in display order. */
export function evaluateRecruiterRules(facts: RecruiterFacts, settings: RecruiterSettings): RuleResult[] {
  return RECRUITER_RULES.map((key) => {
    const weight = settings.weights[key] ?? 0;
    const result = evaluate(key, facts, settings);
    const applicable = result.applicable && weight > 0;
    const credit = Math.min(1, Math.max(0, result.credit));
    return { key, weight, applicable, credit, status: statusOf(applicable, credit), evidence: result.evidence };
  });
}

/** 100 × Σ(weight × credit) / Σ(weight) over the rules that apply; `null` when none does. */
export function recruiterScore(rules: readonly RuleResult[]): number | null {
  let weighted = 0;
  let total = 0;
  for (const rule of rules) {
    if (!rule.applicable) continue;
    weighted += rule.weight * rule.credit;
    total += rule.weight;
  }
  // allowed-literal: a score out of 100
  return total === 0 ? null : Math.round((100 * weighted) / total);
}
