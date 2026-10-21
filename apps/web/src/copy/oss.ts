export const ossCopy = {
  meta: {
    title: 'Open-Source Starter',
    description: 'Beginner-friendly issues in your languages, from projects whose maintainers actually reply.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Open-Source Starter',
    line: 'Find a first open-source issue in a language you know, in a project that answers newcomers.',
  },
  form: {
    title: 'What do you know?',
    loginLabel: 'GitHub username (optional)',
    loginDescription: 'We read your languages from your public repositories.',
    languagesLabel: 'Or pick languages',
    languagesDescription: 'Comma separated, up to 3 are searched. For example: TypeScript, Python.',
    topicsLabel: 'Topics you like (optional)',
    topicsDescription: 'Comma separated, for example: web, machine learning.',
    submit: 'Find issues',
  },
  idleLine: 'Tell me what you know and I will find a friendly first issue.',
  /** Keys match the steps the `oss_search` job reports. */
  steps: [
    { key: 'profile', label: 'Reading your languages' },
    { key: 'searching', label: 'Searching beginner issues' },
    { key: 'projects', label: 'Checking how projects answer' },
    { key: 'ranking', label: 'Ranking' },
  ],
  result: {
    title: (count: number) => `${count} ${count === 1 ? 'issue' : 'issues'} to start with`,
    searched: (languages: string) => `Searched ${languages}.`,
    none: 'No beginner issue matched right now. Try another language, or come back in a few days.',
    relaxed: {
      comments: 'Nothing passed every check, so issues with more discussion are included.',
      responsiveness: 'Nothing passed every check, so projects that answer more slowly are included.',
    },
    reply: (hours: number) =>
      hours < 48 ? `Maintainers usually reply in about ${Math.max(1, Math.round(hours))} hours` : `Maintainers usually reply in about ${Math.round(hours / 24)} days`,
    replyUnknown: 'Reply time unknown',
    match: (share: number) => `${Math.round(share * 100)}% skill match`,
    age: (days: number) => (days < 1 ? 'Opened today' : `Opened ${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'} ago`),
    comments: (count: number) => `${count} ${count === 1 ? 'comment' : 'comments'}`,
  },
  campus: {
    contributed: (count: number) =>
      count === 1 ? '1 member of your university contributed here.' : `${count} members of your university contributed here.`,
    merged: (login: string, count: number) => `@${login} · ${count} merged ${count === 1 ? 'pull request' : 'pull requests'}`,
    askTitle: (login: string) => `Ask @${login} about this project`,
    prefill: (repo: string) => `Hi! I see you've had pull requests merged into ${repo}. I'm thinking of making my first contribution there. Any tips on how to start?`,
  },
} as const;
