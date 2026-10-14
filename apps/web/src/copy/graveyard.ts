export const graveyardCopy = {
  meta: {
    title: 'Project Graveyard',
    description: 'Find inactive open-source projects worth reviving, ranked by promise, demand and how unfinished they are.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Project Graveyard',
    line: 'Search a topic and find inactive projects worth bringing back, with a polite way to ask the owner.',
  },
  form: {
    label: 'Topic or idea',
    description: 'For example “computer vision”, “budget tracker” or “discord bot”.',
    submit: 'Search',
  },
  idleLine: 'Name a topic and I will dig up projects waiting for someone like you.',
  /** Keys match the steps the `graveyard_search` job reports. */
  steps: [
    { key: 'expanding', label: 'Learning what the topic covers' },
    { key: 'searching', label: 'Searching GitHub' },
    { key: 'reading', label: 'Reading each project' },
    { key: 'scoring', label: 'Ranking' },
  ],
  scopes: {
    label: 'Where to search',
    global: 'Global',
    uni: 'My uni',
    country: 'My country',
    uniLocked: {
      title: 'Projects from your university',
      line: 'Classmates will be able to put their own projects up for adoption here once university listings open.',
    },
    countryLocked: {
      title: 'Projects from your country',
      line: 'This opens once the country index of public developers has been built.',
    },
  },
  filters: {
    difficulty: 'Difficulty',
    license: 'License',
    any: 'Any',
    licensed: 'Has a license',
    unlicensed: 'No license',
  },
  difficulty: {
    'weekend-fix': 'Weekend fix',
    'needs-maintainer': 'Needs a maintainer',
    'half-built': 'Half-built idea',
  } as Readonly<Record<string, string>>,
  result: {
    count: (shown: number, total: number) => (shown === total ? `${total} inactive projects` : `${shown} of ${total} inactive projects`),
    widened: (terms: string) => `Also searched: ${terms}.`,
    none: 'No inactive projects matched.',
    tryInstead: 'Try a broader topic:',
    filteredOut: 'No project matches these filters.',
    stars: (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'star' : 'stars'}`,
    forks: (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'fork' : 'forks'}`,
    issues: (count: number) => `${count.toLocaleString('en')} open ${count === 1 ? 'issue' : 'issues'}`,
    idle: (months: number) => `Inactive for ${Math.max(1, Math.round(months))} ${Math.round(months) === 1 ? 'month' : 'months'}`,
    lastPush: (date: string) => `last push ${date}`,
    archived: 'Archived — fork only',
    noLicense: 'No license',
    license: (spdx: string) => spdx,
    revivability: 'Revivability',
    revivabilityValue: (value: number) => `${Math.round(value * 100)}%`,
    whyTitle: 'Why it is here',
    why: {
      readme: 'The README says it is unfinished or lists open tasks.',
      issues: (share: number) => `${Math.round(share * 100)}% of recent open issues have no reply.`,
      commits: (share: number) => `${Math.round(share * 100)}% of recent commit messages mention unfinished work.`,
      noReleases: 'No release has been published.',
    },
  },
  actions: {
    fork: 'Fork on GitHub',
    ask: 'Ask the owner',
    askFirst: 'Ask the owner first',
    noLicenseNote: 'Without a license the code cannot be reused freely. Ask the owner to add one before you build on it.',
  },
  /** The issue a person opens on the owner's repository; it is opened in their own browser, never by us. */
  issue: {
    title: 'Is this project still maintained?',
    body: (repo: string) =>
      [
        `Hi! I came across ${repo} and would love to help bring it back to life.`,
        '',
        'Is it still maintained? If you are no longer working on it, would you be open to me continuing it in a fork, or to adding contributors here?',
        '',
        'Thanks for building it either way.',
      ].join('\n'),
  },
} as const;
