export const fypCopy = {
  meta: {
    title: 'FYP Idea Checker',
    description: 'Paste a final-year project idea and see how close existing projects are, and what makes yours different.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'FYP Idea Checker',
    line: 'Paste your final-year project idea and see how close existing projects are before you commit to it.',
  },
  form: {
    title: 'Your idea',
    titleLabel: 'Title',
    descriptionLabel: 'Description',
    descriptionHelp: (count: number, min: number, max: number) =>
      count < min ? `${count} / ${min} characters minimum: say what it does, for whom, and how.` : `${count} / ${max} characters`,
    submit: 'Check idea',
    again: 'Check again',
  },
  idleLine: 'Describe your idea and I will look for projects like it.',
  /** Keys match the steps the `fyp_check` job reports. */
  steps: [
    { key: 'keyphrases', label: 'Finding the key ideas' },
    { key: 'searching', label: 'Searching GitHub' },
    { key: 'reading', label: 'Reading similar projects' },
    { key: 'comparing', label: 'Comparing' },
  ],
  result: {
    keyphrasesTitle: 'Key ideas we searched for',
    bands: {
      'very-similar': 'Very similar',
      related: 'Related',
      loose: 'Loosely related',
    } as Readonly<Record<string, string>>,
    none: 'No similar project turned up on GitHub. That can be a good sign: check the key ideas above for spelling.',
    similarity: (percent: number) => `${percent}% similar`,
    stars: (count: number) => `${count.toLocaleString('en')} stars`,
    shared: 'Shared ideas:',
    differentTitle: 'What makes yours different',
    differentLine: 'These ideas from your description appear in none of the closest projects.',
    differentNone: 'Every key idea already appears in a close project. Think about what you would add or do differently.',
  },
} as const;
