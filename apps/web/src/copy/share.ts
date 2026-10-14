export const shareCopy = {
  button: 'Share',
  shared: 'Shared.',
  copied: 'Link copied.',
  failed: 'Could not copy the link. Copy it from the address bar.',
  title: (login: string, site: string) => `@${login} on ${site}`,
  imageAlt: (login: string) => `The Dev Card of @${login}`,
  devCard: {
    longestStreak: 'Longest streak',
    activeDays: 'Active days (90)',
    total: 'This year',
    days: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
  },
} as const;
