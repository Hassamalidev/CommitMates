import { describe, expect, it } from 'vitest';

import { evaluateRecruiterRules, recruiterScore, type RecruiterFacts, type RecruiterSettings, type ShowcaseRepo } from './rules';
import {
  commitUnfinishedSignal,
  hasExternalLink,
  isInformativeMessage,
  normalizeCommitMessage,
  readmeUnfinishedSignal,
  termMatcher,
  unfinishedScore,
} from './text';

const settings: RecruiterSettings = {
  weights: {
    profileReadme: 10,
    pinnedCount: 10,
    pinnedReadme: 15,
    pinnedDemo: 10,
    pinnedLicense: 5,
    pinnedDescription: 5,
    pinnedTopics: 5,
    commitMessages: 15,
    unfinishedRatio: 10,
    languageMatch: 5,
    activityConsistency: 10,
  },
  pinnedMin: 2,
  pinnedMax: 6,
  readmeMinChars: 600,
  profileReadmeMinChars: 200,
  minMessageTokens: 3,
  activeDayTarget: 0.5,
};

const repo = (overrides: Partial<ShowcaseRepo> = {}): ShowcaseRepo => ({
  readmeChars: 1000,
  hasDemo: true,
  hasLicense: true,
  hasDescription: true,
  hasTopics: true,
  ...overrides,
});

const perfect: RecruiterFacts = {
  profileReadmeChars: 500,
  pinnedCount: 4,
  showcase: [repo(), repo(), repo(), repo()],
  showcaseSource: 'pinned',
  commitMessages: ['Add building search with fuzzy matching', 'Handle missing grades without crashing'],
  genericMessages: new Set(),
  unfinishedScores: [0, 0.25],
  resumeSkills: ['react', 'python'],
  verifiedSkills: new Set(['react', 'python', 'typescript']),
  activeDayShare: 0.6,
};

describe('commit messages', () => {
  it('normalizes the subject line', () => {
    expect(normalizeCommitMessage(['  Fix   Login Bug (#123)', '', 'Longer body'].join('\n'))).toBe('fix login bug');
    expect(normalizeCommitMessage('Merge GH-42 into main')).toBe('merge into main');
    expect(normalizeCommitMessage('Fixes issue #7')).toBe('fixes');
  });

  it('calls a message informative when it has enough words and is not generic', () => {
    expect(isInformativeMessage('Add building search with fuzzy matching', 3, new Set())).toBe(true);
    expect(isInformativeMessage('fix', 3, new Set())).toBe(false);
    expect(isInformativeMessage('wip #12', 3, new Set())).toBe(false);
    expect(isInformativeMessage('Update README file', 3, new Set(['update readme file']))).toBe(false);
    expect(isInformativeMessage('Update README file', 3, new Set())).toBe(true);
  });
});

describe('unfinished signals', () => {
  const terms = termMatcher(['todo', 'work in progress', 'coming soon']);

  it('matches terms as whole words only', () => {
    expect(terms?.test('This is a work in progress.')).toBe(true);
    expect(terms?.test('TODO: add tests')).toBe(true);
    expect(terms?.test('A todolist app')).toBe(false);
    expect(termMatcher([])).toBeNull();
    expect(termMatcher(['  '])).toBeNull();
  });

  it('reads README terms and unchecked tasks', () => {
    expect(readmeUnfinishedSignal('# App\nComing soon!', terms)).toBe(1);
    expect(readmeUnfinishedSignal('# App\n- [x] done\n- [ ] export to PDF', terms)).toBe(1);
    expect(readmeUnfinishedSignal('# App\n- [x] done\nUsage: run it.', terms)).toBe(0);
    expect(readmeUnfinishedSignal('- [ ] still a task', null)).toBe(1);
  });

  it('measures commit messages and averages what applies', () => {
    expect(commitUnfinishedSignal(['WIP: login', 'todo later', 'Add tests'], termMatcher(['wip', 'todo']))).toBeCloseTo(2 / 3, 12);
    expect(commitUnfinishedSignal([], terms)).toBeNull();
    expect(commitUnfinishedSignal(['todo'], null)).toBe(0);
    expect(unfinishedScore([1, null, 0])).toBe(0.5);
    expect(unfinishedScore([null])).toBeNull();
  });
});

describe('hasExternalLink', () => {
  it('finds links to a live site outside GitHub', () => {
    expect(hasExternalLink('Try it at https://campus-map.example.org today')).toBe(true);
    expect(hasExternalLink('[Live demo](https://demo.example.com)')).toBe(true);
    expect(hasExternalLink('See <https://docs.example.com>')).toBe(true);
    expect(hasExternalLink('Hosted on [Pages](https://someone.github.io/app)')).toBe(true);
  });

  it('ignores GitHub links and images', () => {
    expect(hasExternalLink('[source](https://github.com/someone/app)')).toBe(false);
    expect(hasExternalLink('![screenshot](https://raw.githubusercontent.com/a/b/main/s.png)')).toBe(false);
    expect(hasExternalLink('![badge](https://img.shields.io/badge/x-y-green)')).toBe(false);
    expect(hasExternalLink('no links here')).toBe(false);
    expect(hasExternalLink('[broken](https://)')).toBe(false);
  });
});

describe('evaluateRecruiterRules', () => {
  it('gives full marks to a profile that does everything', () => {
    const rules = evaluateRecruiterRules(perfect, settings);
    expect(rules.every((rule) => rule.status === 'pass')).toBe(true);
    expect(recruiterScore(rules)).toBe(100);
  });

  it('gives partial credit with the evidence behind it', () => {
    const rules = evaluateRecruiterRules(
      { ...perfect, showcase: [repo(), repo({ readmeChars: 120, hasDemo: false }), repo({ readmeChars: 0, hasLicense: false })] },
      settings,
    );
    const readme = rules.find((rule) => rule.key === 'pinnedReadme');
    expect(readme).toMatchObject({ status: 'partial', evidence: { met: 1, total: 3, min: 600, source: 'pinned' } });
    expect(readme?.credit).toBeCloseTo(1 / 3, 12);
    expect(rules.find((rule) => rule.key === 'pinnedDemo')?.credit).toBeCloseTo(2 / 3, 12);
  });

  it('scores the pinned count by the configured range', () => {
    const credit = (pinnedCount: number) =>
      evaluateRecruiterRules({ ...perfect, pinnedCount }, settings).find((rule) => rule.key === 'pinnedCount')?.credit;
    expect(credit(0)).toBe(0);
    expect(credit(1)).toBe(0.5);
    expect(credit(2)).toBe(1);
    expect(credit(6)).toBe(1);
    expect(credit(7)).toBe(0);
  });

  it('needs a profile README of the minimum length', () => {
    const status = (chars: number | null) =>
      evaluateRecruiterRules({ ...perfect, profileReadmeChars: chars }, settings).find((rule) => rule.key === 'profileReadme')?.status;
    expect(status(null)).toBe('fail');
    expect(status(199)).toBe('fail');
    expect(status(200)).toBe('pass');
  });

  it('judges commit messages, unfinished projects, claimed skills and consistency', () => {
    const rules = evaluateRecruiterRules(
      {
        ...perfect,
        commitMessages: ['fix', 'wip', 'Add building search with fuzzy matching', 'update readme file'],
        genericMessages: new Set(['update readme file']),
        unfinishedScores: [1, 0.5, 0, null],
        resumeSkills: ['react', 'kubernetes', 'go'],
        activeDayShare: 0.25,
      },
      settings,
    );
    const byKey = Object.fromEntries(rules.map((rule) => [rule.key, rule]));
    expect(byKey.commitMessages).toMatchObject({ credit: 0.25, evidence: { informative: 1, total: 4 } });
    expect(byKey.unfinishedRatio?.credit).toBeCloseTo(1 / 3, 12);
    expect(byKey.unfinishedRatio?.evidence).toEqual({ unfinished: 2, examined: 3 });
    expect(byKey.languageMatch).toMatchObject({ evidence: { matched: 1, total: 3, missing: ['kubernetes', 'go'] } });
    expect(byKey.activityConsistency?.credit).toBe(0.5);
  });

  it('re-normalizes the score over the rules that apply', () => {
    const rules = evaluateRecruiterRules(
      { ...perfect, showcase: [], commitMessages: [], unfinishedScores: [], resumeSkills: [], profileReadmeChars: null },
      settings,
    );
    const applicable = rules.filter((rule) => rule.applicable).map((rule) => rule.key);
    expect(applicable).toEqual(['profileReadme', 'pinnedCount', 'activityConsistency']);
    expect(rules.find((rule) => rule.key === 'languageMatch')?.status).toBe('not-applicable');
    // profileReadme 0 × 10, pinnedCount 1 × 10, activity 1 × 10 → 20 / 30.
    expect(recruiterScore(rules)).toBe(67);
  });

  it('leaves out rules weighted zero or missing from the settings', () => {
    const rules = evaluateRecruiterRules(perfect, { ...settings, weights: { pinnedCount: 10, activityConsistency: 0 } });
    expect(rules.filter((rule) => rule.applicable).map((rule) => rule.key)).toEqual(['pinnedCount']);
    expect(recruiterScore(rules)).toBe(100);
    expect(recruiterScore(evaluateRecruiterRules(perfect, { ...settings, weights: {} }))).toBeNull();
  });

  it('treats a non-positive activity target as unmet', () => {
    const rules = evaluateRecruiterRules(perfect, { ...settings, activeDayTarget: 0 });
    expect(rules.find((rule) => rule.key === 'activityConsistency')?.credit).toBe(0);
  });
});
