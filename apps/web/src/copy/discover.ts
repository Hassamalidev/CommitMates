import type { MatchMode } from '@commitmates/algorithms';

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;

export const discoverCopy = {
  meta: { title: 'Discover' },
  eyebrow: 'Find a partner',
  title: 'Discover',
  intro: 'People at your university who fit what you want to build or learn. New suggestions every day.',
  modesLabel: 'What are you looking for?',
  modes: {
    study: { label: 'Study buddy', line: 'People who build with what you build.' },
    teammate: { label: 'Teammate', line: 'People strong where you want to grow.' },
    explore: { label: 'Explore', line: 'A mix of both.' },
  } satisfies Record<MatchMode, { label: string; line: string }>,
  card: {
    details: (login: string, department: string | null, gradYear: number | null) =>
      [`@${login}`, department, gradYear === null ? null : `Class of ${gradYear}`].filter(Boolean).join(' · '),
    companionLabel: (login: string) => `@${login}'s companion`,
    tagsLabel: 'Top skills',
    reasonsTitle: 'Why you might click',
    count: (position: number, total: number) => `${position} of ${total} today`,
    profileLink: 'View profile',
  },
  why: {
    sharedTags: (tags: readonly string[]) => `You both build with ${list(tags)}.`,
    coverageGoals: (tags: readonly string[]) => `They're strong in ${list(tags)}, which ${tags.length === 1 ? 'is' : 'are'} on your learning list.`,
    coverageGaps: (tags: readonly string[]) => `They know ${list(tags)}, which you haven't used yet.`,
    sharedInterests: (count: number) =>
      count === 1 ? 'You share a topic across your repos and stars.' : `You share ${count} topics across your repos and stars.`,
    window: (from: string, to: string) => `You both often code between ${from} and ${to}.`,
  },
  actions: {
    skip: 'Skip',
    like: 'Like',
    request: 'Request chat',
    hintsLabel: 'Keyboard:',
    skipped: (login: string) => `Skipped @${login}.`,
    liked: (login: string) => `Liked @${login}. They're in your liked list for today.`,
  },
  request: {
    title: (login: string) => `Message @${login}`,
    description: 'Say who you are and why you would like to talk. They see this before deciding.',
    label: 'First message',
    help: (min: number, max: number) => `Between ${min} and ${max} characters. Plain text; links are fine.`,
    counter: (length: number, max: number) => `${length} / ${max}`,
    submit: 'Send request',
    close: 'Close',
    sent: (login: string) => `Request sent to @${login}. They'll see it with your message.`,
  },
  liked: {
    title: 'Liked today',
    empty: 'People you like appear here, so you can message them later today.',
  },
  filters: {
    title: 'Filters',
    department: 'Department',
    anyDepartment: 'Any department',
    yearFrom: 'Graduating from',
    yearTo: 'Graduating by',
    tag: 'Skill',
    anyTag: 'Any skill',
    apply: 'Apply filters',
    clear: 'Clear filters',
  },
  empty: {
    seenEveryone: { title: "You've seen everyone for today", line: 'New people tomorrow.' },
    filtered: { title: 'Nobody here matches these filters', line: 'Try fewer filters, or clear them to see the whole deck.' },
    firstDeck: { title: 'Your first suggestions arrive tonight', line: 'Decks are built once a day for everyone at your university.' },
  },
  emptyProfile: {
    title: 'Tell us what you want to learn',
    line: "Your public GitHub doesn't show skills yet, so we start you in Explore. Learning goals help us find people who know them.",
    label: 'Learning goals',
    help: 'Comma-separated tags for the languages and tools you want to learn.',
    helpWithExamples: (examples: readonly string[]) => `Comma-separated tags. Popular here: ${examples.join(', ')}.`,
    submit: 'Save goals',
    saved: 'Saved. Your next deck will use them.',
  },
  locked: {
    line: 'Discover opens when enough people from your university have joined. Invite classmates to get there sooner.',
  },
  similar: {
    title: 'Developers like you on GitHub',
    line: (language: string, country: string) => `Public GitHub profiles that use ${language} in ${country}. View only: they are not on CommitMates.`,
    noLanguage: 'Once your public repositories show a main language, people who use it near you appear here.',
    unavailable: 'GitHub is busy right now. This list will be back shortly.',
    empty: 'No public profiles found for now.',
    open: (login: string) => `@${login} on GitHub`,
    loading: 'Looking for developers like you…',
  },
} as const;
