export const gapCopy = {
  meta: {
    title: 'Gap Finder',
    description: 'See what similar successful projects usually have that yours does not: tests, CI, containers, docs and more.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Gap Finder',
    line: 'Paste a project and see what similar, well-starred projects usually have that yours does not yet.',
  },
  form: {
    title: 'Which project?',
    label: 'GitHub repository link',
    description: 'A public repository, for example https://github.com/you/project.',
    submit: 'Find gaps',
    again: 'Check again',
  },
  idleLine: 'Give me a project and I will compare it with its successful neighbours.',
  /** Keys match the steps the `gap_analysis` job reports. */
  steps: [
    { key: 'repo', label: 'Reading your project' },
    { key: 'peers', label: 'Finding similar projects' },
    { key: 'reading', label: 'Reading similar projects' },
    { key: 'comparing', label: 'Comparing' },
  ],
  result: {
    title: (repo: string) => `What similar projects have that ${repo} does not`,
    noGaps: 'Nothing stands out: your project already has what most similar projects have.',
    have: (count: number, total: number) => `${count} of ${total} similar repos have this`,
    examples: 'For example:',
    lowConfidence: 'Only a few similar projects were found, so treat these as hints. A link to a sub-project of a monorepo may compare better.',
    sharedTitle: 'You are doing these right',
    peersTitle: (count: number) => `Compared with ${count} similar ${count === 1 ? 'project' : 'projects'}`,
    stars: (count: number) => `${count.toLocaleString('en')} stars`,
  },
  facet: {
    dir: (name: string) => `A ${name}/ folder`,
    file: (name: string) => `A ${name} file`,
    tag: (name: string) => `Uses ${name}`,
    topic: (topic: string) => `(${topic})`,
    meta: {
      license: 'A license',
      homepage: 'A website or demo link',
      releases: 'Published releases',
      topics: 'Topics on the repository',
      description: 'A description',
    } as Readonly<Record<string, string>>,
  },
  campus: {
    title: 'Who at your uni can help',
    line: (members: number) =>
      `Members of your university who know these skills appear here once it has ${members} verified members. Sign in and verify to count yourself in.`,
    verify: 'Verify your university to see classmates who know these skills.',
    locked: (current: number, required: number) => `This opens at ${required} verified members of your university (${current} so far).`,
    loading: 'Looking for classmates who know these skills…',
    failed: 'We could not load this right now. Try again in a moment.',
    intro: 'Classmates whose code shows these skills more than most members here.',
    none: 'Nobody here shows these skills in their code yet.',
    forGap: (label: string) => label,
    nobodyFor: 'Nobody yet.',
    ask: {
      title: (login: string) => `Ask @${login} for help`,
      prefill: (repo: string, label: string) =>
        `Hi! Gap Finder says my project ${repo} is missing ${label.charAt(0).toLowerCase()}${label.slice(1)}, and your code shows you know it well. Could you point me in the right direction?`,
    },
  },
} as const;
