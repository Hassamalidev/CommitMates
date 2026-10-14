const percent = (value: number) => `${Math.round(value * 100)}%`;

export const compatCopy = {
  meta: {
    title: 'Compatibility Check',
    description: 'Two GitHub usernames in, an honest coding-partner compatibility breakdown out.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Compatibility Check',
    line: 'Would you two work well together? Compare skills, interests and the hours you actually code.',
  },
  form: {
    title: 'Who are we comparing?',
    labelA: 'First GitHub username',
    labelB: 'Second GitHub username',
    descriptionA: 'Yours, or anyone else’s.',
    submit: 'Compare',
    again: 'Compare again',
  },
  idleLine: 'Give me two usernames and I will see how they fit.',
  /** Keys match the steps the `compat_check` job reports. */
  steps: [
    { key: 'first', label: 'Reading the first profile' },
    { key: 'second', label: 'Reading the second profile' },
    { key: 'stars', label: 'Reading starred repositories' },
    { key: 'comparing', label: 'Comparing' },
  ],
  result: {
    title: (a: string, b: string) => `@${a} and @${b}`,
    scoreLabel: 'Compatibility score',
    scoreValue: (score: number) => `${score} out of 100`,
    noScore: 'Not enough public activity on either side to compare yet.',
    companionLabel: (login: string) => `The companion of @${login}`,
    componentsTitle: 'The breakdown',
    notEnoughData: 'Not enough data',
    whyTitle: 'Why',
    nothingShared: 'Nothing in common yet in public data, which can make for a good complement.',
  },
  components: {
    skill: { name: 'Skills', line: 'How much your languages and skills overlap.' },
    interest: { name: 'Interests', line: 'Topics you both build with or star.' },
    rhythm: { name: 'Rhythm', line: 'How much the hours you code overlap.' },
    complement: { name: 'Complement', line: 'How much each of you covers what the other does not.' },
  },
  componentValue: (value: number) => percent(value),
  explanations: {
    sharedTags: (tags: readonly string[]) => `You both build with ${tags.join(', ')}.`,
    sharedStars: (repos: readonly string[]) => `You both starred ${repos.join(', ')}.`,
    window: (from: string, to: string) => `You are both most active between ${from} and ${to} your time.`,
    strength: (login: string, tag: string) => `@${login} brings ${tag}.`,
  },
  bands: {
    'different-worlds': { title: 'Different worlds', line: 'Little overlap so far. Different can still mean you learn a lot from each other.' },
    'good-pair': { title: 'Good pair', line: 'Enough in common to start, enough difference to grow.' },
    'strong-pair': { title: 'Strong pair', line: 'You line up on skills and timing. Worth building something together.' },
    'dream-team': { title: 'Dream team', line: 'Rare overlap in what you build and when you build it.' },
  } as Readonly<Record<string, { title: string; line: string }>>,
  fallbackBand: { title: 'Your result', line: 'Here is how you compare.' },
  cta: {
    title: 'Find people like this at your uni',
    line: 'Sign in to meet developers at your own university whose skills match or complete yours.',
    action: 'Sign in',
  },
} as const;

export type CompatComponentKey = keyof typeof compatCopy.components;
