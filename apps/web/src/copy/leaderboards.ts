const percent = (share: number) => `${Math.round(share * 100)}%`;

export const leaderboardsCopy = {
  meta: { title: 'Leaderboards' },
  eyebrow: 'Leaderboards',
  title: 'Who kept coding this week',
  intro: 'Friendly competition, measured per person so size does not win. Boards are rebuilt every Monday for the week that just ended.',
  locked: 'Leaderboards open once enough members of your university have joined. Invite classmates to get there sooner.',
  tabs: { label: 'Boards', universities: 'Universities', departments: 'Departments', members: 'Members' },
  week: (start: string) => `Week of ${start}`,
  empty: {
    universities: 'No board yet. The first one appears after the next Monday.',
    departments: (min: number) => `No department board yet. A department needs ${min} verified members to be ranked.`,
    members: 'Nobody here has joined the members board yet.',
  },
  you: 'You',
  yours: 'Yours',
  rank: (rank: number) => `#${rank}`,
  change: (previous: number | null, rank: number) =>
    previous === null ? 'New this week' : previous === rank ? 'Same as last week' : previous > rank ? `Up ${previous - rank}` : `Down ${rank - previous}`,
  metrics: {
    activeRatio: (share: number) => `${percent(share)} of members active`,
    medianActiveDays: (days: number) => `median ${days} active ${days === 1 ? 'day' : 'days'}`,
    revivals: (count: number) => `${count} ${count === 1 ? 'revival' : 'revivals'}`,
    helpfulReviews: (count: number) => `${count} helpful ${count === 1 ? 'review' : 'reviews'}`,
    activeDays: (days: number) => `${days} active ${days === 1 ? 'day' : 'days'}`,
  },
  companion: (name: string) => `${name}'s companion`,
  how: {
    title: 'How scoring works',
    lines: (minActiveDays: number, weights: { activeRatio: number; medianActiveDays: number; revivals: number; helpfulReviews: number }) => [
      `A day counts as active when it has at least one contribution on GitHub; many commits in one day still count once. A member is active in a week with ${minActiveDays} or more active days.`,
      `Universities and departments are scored on the share of active members (${percent(weights.activeRatio)}), their median active days (${percent(weights.medianActiveDays)}), projects revived (${percent(weights.revivals)}) and helpful reviews (${percent(weights.helpfulReviews)}), each compared with the others on the same board.`,
      'The members board lists only people who chose to join it, by active days, then helpful reviews.',
    ],
  },
  home: {
    title: 'Leaderboards',
    open: 'See how your university and department did last week.',
    locked: (current: number, required: number) => `Opens at ${required} verified members (${current} so far).`,
    link: 'Open the leaderboards',
  },
  optIn: {
    title: 'The members board',
    inLine: 'You are on your university’s members board.',
    outLine: 'Join your university’s members board to see where your week ranks among classmates who joined too.',
    join: 'Join the members board',
    leave: 'Leave the members board',
    joined: 'Joined. You will appear after the next Monday.',
    left: 'You left the members board.',
  },
} as const;
