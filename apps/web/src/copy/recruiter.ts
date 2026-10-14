type Evidence = Readonly<Record<string, unknown>>;

const num = (evidence: Evidence, key: string): number => {
  const value = evidence[key];
  return typeof value === 'number' ? value : 0;
};
const list = (evidence: Evidence, key: string): string[] => {
  const value = evidence[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};
const repos = (evidence: Evidence) => (evidence.source === 'top' ? 'top repositories' : 'pinned repositories');
const share = (evidence: Evidence, what: string) => `${num(evidence, 'met')} of ${num(evidence, 'total')} ${repos(evidence)} ${what}.`;

export type RecruiterRuleCopy = { title: string; evidence: (evidence: Evidence) => string; fix: string };

export const recruiterCopy = {
  meta: {
    title: 'Recruiter-Ready Score',
    description: 'How a GitHub profile reads to a recruiter in the first minute, with evidence and a fix for every point.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Recruiter-Ready Score',
    line: 'See your GitHub profile the way a recruiter skims it, and exactly what to fix first.',
  },
  form: {
    title: 'Whose profile?',
    label: 'GitHub username',
    skillsLabel: 'Skills on your CV (optional)',
    skillsDescription: 'Comma or line separated, up to 30. We check which ones your code shows.',
    scanLabel: 'Also scan my repositories for leaked keys',
    scanDescription: 'Only for your own account. Only you will see the results.',
    submit: 'Check profile',
    again: 'Check again',
  },
  idleLine: 'Give me a GitHub username and I will read it like a recruiter would.',
  /** Keys match the steps the `recruiter_report` job reports. */
  steps: [
    { key: 'profile', label: 'Reading the profile' },
    { key: 'readmes', label: 'Reading READMEs and commit messages' },
    { key: 'secrets', label: 'Scanning for leaked keys' },
    { key: 'scoring', label: 'Scoring' },
  ],
  result: {
    title: (login: string) => `@${login} through a recruiter's eyes`,
    scoreLabel: 'Recruiter-Ready score',
    scoreValue: (score: number) => `${score} out of 100`,
    noScore: 'Nothing to score yet: no rule could be checked.',
    checklistTitle: 'The checklist',
    fixLabel: 'How to fix',
    status: { pass: 'Passed', partial: 'Partly met', fail: 'Not met' },
    usedTop: 'No pinned repositories, so the checks use the top repositories by stars.',
    notChecked: (names: string) => `Not checked this time: ${names}.`,
  },
  rules: {
    profileReadme: {
      title: 'Profile README',
      evidence: (e: Evidence) =>
        e.chars === null
          ? 'There is no profile README (a repository with the same name as the account).'
          : `The profile README has ${num(e, 'chars')} characters; ${num(e, 'chars') >= num(e, 'min') ? 'enough to introduce someone' : `aim for at least ${num(e, 'min')}`}.`,
      fix: 'Create a repository named exactly like the username and add a README: who you are, what you build and what you are looking for.',
    },
    pinnedCount: {
      title: 'Pinned repositories',
      evidence: (e: Evidence) => `${num(e, 'count')} pinned (aim for ${num(e, 'min')} to ${num(e, 'max')}).`,
      fix: 'Pin the repositories that show your best work: on your GitHub profile, choose “Customize your pins”.',
    },
    pinnedReadme: {
      title: 'READMEs',
      evidence: (e: Evidence) => share(e, `have a README over ${num(e, 'min')} characters`),
      fix: 'Add a README that says what the project does, how to run it and what it looks like.',
    },
    pinnedDemo: {
      title: 'Live demos',
      evidence: (e: Evidence) => share(e, 'link to a live demo or site'),
      fix: 'Deploy it (GitHub Pages is free) and put the link in the repository’s website field.',
    },
    pinnedLicense: {
      title: 'Licenses',
      evidence: (e: Evidence) => share(e, 'have a license'),
      fix: 'Add a LICENSE file (MIT is a common choice) so others know they may use the code.',
    },
    pinnedDescription: {
      title: 'Descriptions',
      evidence: (e: Evidence) => share(e, 'have a description'),
      fix: 'Add a one-line description in the repository’s About box.',
    },
    pinnedTopics: {
      title: 'Topics',
      evidence: (e: Evidence) => share(e, 'have topics'),
      fix: 'Add a few topics in the About box so the project shows up in searches.',
    },
    commitMessages: {
      title: 'Commit messages',
      evidence: (e: Evidence) => `${num(e, 'informative')} of ${num(e, 'total')} recent commit messages say what changed.`,
      fix: 'Write messages like “Add CSV export to reports” rather than “fix” or “update”.',
    },
    unfinishedRatio: {
      title: 'Finished projects',
      evidence: (e: Evidence) => `${num(e, 'unfinished')} of ${num(e, 'examined')} examined repositories look unfinished.`,
      fix: 'Finish, archive or explain unfinished projects in their README, or put them up for adoption.',
    },
    languageMatch: {
      title: 'Skills you listed',
      evidence: (e: Evidence) => {
        const missing = list(e, 'missing');
        return `${num(e, 'matched')} of ${num(e, 'total')} skills you listed show up in the code.${missing.length > 0 ? ` Not found: ${missing.join(', ')}.` : ''}`;
      },
      fix: 'Add a small project that uses the missing skills, or keep your list to what your code shows.',
    },
    activityConsistency: {
      title: 'Steady activity',
      evidence: (e: Evidence) =>
        `Active on ${Math.round(num(e, 'activeDayShare') * 100)}% of the last 90 days (aim for ${Math.round(num(e, 'target') * 100)}%).`,
      fix: 'Small, regular commits show steady work better than rare large ones.',
    },
  } satisfies Record<string, RecruiterRuleCopy>,
  secrets: {
    title: 'Leaked keys in your repositories',
    line: 'Only you can see this. We never store or show the key itself, only where it is.',
    finding: (rule: string, repo: string, path: string, line: number) => `${rule} in ${repo}/${path}, line ${line}`,
    fix: 'Revoke the key with its provider and create a new one. Deleting the file does not remove the key from git history.',
    none: (files: number) => `No leaked keys found in ${files} ${files === 1 ? 'file' : 'files'}.`,
    partial: (files: number) => `We scanned ${files} files; some repositories were too large to scan completely.`,
    loading: 'Loading your scan…',
    failed: 'We could not load your scan. Reload the page to try again.',
  },
} as const;

export type RecruiterRuleKey = keyof typeof recruiterCopy.rules;

export const isRecruiterRuleKey = (key: string): key is RecruiterRuleKey => key in recruiterCopy.rules;

/** "github-pat" → "github pat": a rule id as words. */
export const secretRuleName = (ruleId: string) => ruleId.replace(/[-_]+/g, ' ');

/** Splits pasted skills on commas and new lines. */
export function parseSkills(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((skill) => skill.trim()).filter((skill) => skill !== ''))];
}
