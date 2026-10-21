const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The member-only parts of a profile page (CLAUDE.md §8 F1, P5-T10). */
export const profileCopy = {
  badges: {
    title: 'Badges',
    none: 'No badges yet. Reviews, revived projects, shared streaks and open-source pull requests earn them.',
    reviewer: { name: 'Reviewer', line: (tier: string, helpful: number) => `${tier} · ${plural(helpful, 'helpful review', 'helpful reviews')}` },
    reviver: { name: 'Reviver', line: (count: number) => `Brought ${plural(count, 'project', 'projects')} back to life` },
    streak: { name: 'Streak', line: (days: number) => `Longest shared streak: ${plural(days, 'day', 'days')}` },
    oss: { name: 'Open source', line: (merged: number, projects: number) => `${plural(merged, 'merged pull request', 'merged pull requests')} to ${plural(projects, 'project', 'projects')}` },
  },
  revived: {
    title: 'Revived projects',
    adopter: 'Adopted and revived',
    owner: 'Their project, revived by a classmate',
    unknown: 'A project from the Graveyard',
    fork: (fork: string) => `continued in ${fork}`,
  },
  showcase: {
    title: 'Showcased projects',
    open: (name: string) => `Open ${name} in Senior’s Legacy`,
  },
} as const;
