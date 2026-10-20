export const shareCopy = {
  button: 'Share',
  shared: 'Shared.',
  copied: 'Link copied.',
  failed: 'Could not copy the link. Copy it from the address bar.',
  title: (login: string, site: string) => `@${login} on ${site}`,
  imageAlt: (login: string) => `The Dev Card of @${login}`,
  compareTitle: (a: string, b: string, site: string) => `@${a} and @${b} on ${site}`,
  compat: { score: 'Compatibility' },
  devCard: {
    longestStreak: 'Longest streak',
    activeDays: 'Active days (90)',
    total: 'This year',
    days: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
  },
  streak: {
    current: 'Shared streak',
    days: (count: number) => (count === 1 ? '1 day' : `${count} days`),
    longest: (count: number) => `Longest: ${count === 1 ? '1 day' : `${count} days`}`,
    pair: (a: string, b: string) => `@${a} and @${b}`,
  },
} as const;
