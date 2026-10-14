import type { UnlockKey } from '@commitmates/core';

export const campusCopy = {
  meta: { title: (name: string) => name },
  eyebrow: 'University',
  members: (count: number) => (count === 1 ? '1 verified member' : `${count} verified members`),
  alumni: (count: number) => (count === 1 ? '1 alumnus or alumna' : `${count} alumni`),
  topicsTitle: 'What members build with',
  topicsEmpty: 'Topics appear once members have public repositories with topics.',
  topicsLabel: (topic: string, members: number) => `${topic}: ${members === 1 ? '1 member' : `${members} members`}`,
  unlocksTitle: 'Campus features',
  unlocksIntro: 'Each feature opens when enough people from this university have joined.',
  unlocked: 'Open',
  progress: {
    members: (current: number, required: number) => `${current} / ${required} verified members`,
    alumni: (current: number, required: number) => `${current} / ${required} verified alumni`,
    legacyProjects: (current: number, required: number) => `${current} / ${required} showcased projects`,
  },
  unlocks: {
    matching: { title: 'Find a partner', line: 'A daily list of people here who fit what you want to build or learn.' },
    reviews: { title: 'Review Exchange', line: 'Give a code review on GitHub, get one back from someone here.' },
    swap: { title: 'Skill Swap', line: 'Teach a skill your code proves, learn one from someone else.' },
    gapCampus: { title: 'Who can help', line: 'Gap Finder shows members here who know what your project is missing.' },
    leaderboard: { title: 'Leaderboards', line: 'How active this university is, per person, against others in the country.' },
    fypBoard: { title: 'FYP Board', line: 'Final-year project ideas, supervisors and teams, with duplicate checks.' },
    alumni: { title: 'Alumni Quick Asks', line: 'Short questions answered by alumni who know the topic.' },
    legacy: { title: "Seniors' projects", line: 'A library of projects built by seniors and alumni here.' },
  } satisfies Record<UnlockKey, { title: string; line: string }>,
  invite: {
    button: 'Copy invite link',
    copied: 'Link copied',
    label: 'Your invite link',
    uses: (count: number) => (count === 1 ? '1 person joined with your link.' : `${count} people joined with your link.`),
    onlyMembers: 'Members of this university can invite others here.',
  },
} as const;

/** A text field of stored notification data; anything else reads as empty. */
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Lines for the notifications a member can have so far; unknown kinds are not shown. */
export const notificationCopy: Readonly<Record<string, (data: Record<string, unknown>) => string>> = {
  university_request_approved: (data) =>
    `Your request for ${text(data.domain)} was approved${text(data.universityName) ? ` as ${text(data.universityName)}` : ''}.`,
  university_request_rejected: (data) => `Your request for ${text(data.domain)} was not approved.`,
  verified_by_vouches: () => 'Members of your university vouched for you. You are verified.',
};

export const homeNotificationsCopy = {
  title: 'Recent updates',
  empty: 'Nothing new yet.',
} as const;
