const percent = (share: number) => `${Math.round(share * 100)}%`;

export const devCardCopy = {
  meta: {
    title: 'Dev Card',
    description: 'A visual profile built from real GitHub activity: languages, skills, coding rhythm and a companion of your own.',
    profileTitle: (login: string) => `@${login}`,
    profileDescription: (login: string) => `The Dev Card of @${login}: languages, skills and coding rhythm from real GitHub activity.`,
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Dev Card',
    line: 'Enter a GitHub username and see the developer behind it: languages, skills verified from code, and when they actually code.',
  },
  form: {
    title: 'Whose card?',
    label: 'GitHub username',
    description: 'Public data only. Nothing is posted anywhere.',
    submit: 'Build card',
    again: 'Build another',
  },
  idleLine: 'Give me a GitHub username and I will get to work.',
  /** Keys match the steps the `analyze_profile` job reports. */
  steps: [
    { key: 'finding', label: 'Finding the account' },
    { key: 'repos', label: 'Reading repos' },
    { key: 'activity', label: 'Reading activity' },
    { key: 'building', label: 'Building the card' },
  ],
  card: {
    title: (name: string) => `${name}'s Dev Card`,
    githubLink: (login: string) => `@${login} on GitHub`,
    companionLabel: (login: string) => `The companion of @${login}`,
    labelsTitle: 'Coding personality',
    languagesTitle: 'Languages',
    languagesLabel: 'Languages by share of code',
    languageHeading: 'Language',
    shareHeading: 'Share',
    noLanguages: 'No code in public repositories yet.',
    rhythmTitle: 'Rhythm',
    rhythmLabel: 'Most active hours',
    rhythmEmpty: 'No public activity in this window.',
    windowNote: 'Based on public activity in the last 90 days.',
    timezone: {
      profile: (zone: string) => `Hours are in your profile timezone (${zone}).`,
      location: (zone: string) => `Hours are in ${zone}, from the location on the GitHub profile. © OpenStreetMap contributors`,
      utc: 'No timezone is known for this profile, so hours are in UTC.',
    },
    calendarTitle: 'Last 90 days',
    calendarLabel: 'Contributions per day in the last 90 days',
    calendarHint: 'Hover, tap or use the arrow keys to read a day.',
    dateHeading: 'Date',
    countHeading: 'Contributions',
    day: (date: string, count: number) => `${date}: ${count} ${count === 1 ? 'contribution' : 'contributions'}`,
    statsTitle: 'In numbers',
    stats: {
      longestStreak: 'Longest streak this year',
      activeDays: 'Active days in the last 90',
      total: 'Contributions this year',
      days: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
    },
    tagsTitle: 'Top skills',
    tagsNote: 'From the dependencies and topics of public repositories.',
    noTags: 'No skill tags yet. They appear once repositories declare dependencies or topics.',
    privateIncluded: 'Includes private contribution counts, because this account shows them on GitHub.',
    reposTruncated: (count: number) => `Based on the ${count} most recently pushed repositories.`,
    fewEvents: 'Too little recent public activity to describe a rhythm yet.',
  },
  notEnough: {
    title: 'Not much to show yet',
    line: 'Not much public activity in the last 90 days. Sign in to include private contribution counts.',
  },
  labels: {
    nightOwl: { name: 'Night Owl', evidence: (m: Metrics) => `${percent(m.nightShare)} of activity between 22:00 and 04:00.` },
    earlyBird: { name: 'Early Bird', evidence: (m: Metrics) => `${percent(m.morningShare)} of activity between 05:00 and 09:00.` },
    weekendWarrior: { name: 'Weekend Warrior', evidence: (m: Metrics) => `${percent(m.weekendShare)} of contributions on weekends.` },
    sprinter: { name: 'Sprinter', evidence: () => 'Work arrives in intense bursts with quiet days between.' },
    marathoner: { name: 'Marathoner', evidence: (m: Metrics) => `Active on ${m.activeDays90} of the last 90 days.` },
    balanced: { name: 'Balanced', evidence: () => 'No single pattern stands out: a steady mix of hours and days.' },
  },
  profile: {
    eyebrow: 'Member profile',
    hiddenFromOthers: 'Only you can see this page. Change who can see it in your privacy settings.',
  },
} as const;

type Metrics = { nightShare: number; morningShare: number; weekendShare: number; activeDays90: number };

export type DevCardLabelKey = keyof typeof devCardCopy.labels;

export const isDevCardLabelKey = (key: string): key is DevCardLabelKey => key in devCardCopy.labels;
