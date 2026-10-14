export const onboardingCopy = {
  meta: { title: 'Verify your university' },
  title: 'Verify your university',
  intro: 'Campus features are for verified students and alumni. Confirm your university email once and you are in.',
  email: {
    title: 'Your university email',
    label: 'University email',
    description: 'We only use it to send one code. After you verify, we keep the domain, not the address.',
    submit: 'Send code',
  },
  choose: {
    legend: 'Several universities use this email domain. Which one is yours?',
    submit: 'Send code',
  },
  unknown: (domain: string) =>
    `We don't recognize ${domain} as a university domain yet. Check the spelling, or try your university's main email address.`,
  request: {
    title: 'Request your university',
    line: 'Tell us which university uses this domain. A moderator or admin checks it, then you can verify by email.',
    name: 'University name',
    country: 'Country',
    countryPlaceholder: 'Choose a country',
    submit: 'Send request',
    sent: 'Thanks. We will let you know once it is reviewed.',
    status: {
      pending: (domain: string) => `Your request for ${domain} is waiting for review.`,
      approved: (domain: string) => `Your request for ${domain} was approved. Verify with your university email now.`,
      rejected: (domain: string) => `Your request for ${domain} was not approved.`,
    },
    note: (note: string) => `Reviewer's note: ${note}`,
  },
  code: {
    title: 'Enter your code',
    sent: (university: string) => `We sent a 6-digit code for ${university}. It can take a minute to arrive.`,
    pendingSent: (university: string) => `Your code for ${university} is on its way or already in your inbox.`,
    label: 'Verification code',
    submit: 'Verify',
    resend: 'Send a new code',
    other: 'Use a different email',
  },
  vouch: {
    title: 'No university email?',
    line: (required: number) =>
      `Pick your university, then ask ${required} members who are verified there to vouch for you from your profile page.`,
    searchLabel: 'Search universities',
    search: 'Search',
    none: 'No university matches that name.',
    choose: 'This is my university',
    chosen: 'Saved.',
    waiting: (university: string, vouches: number, required: number) => `${university}: ${vouches} of ${required} vouches so far.`,
    share: 'Send them your profile link:',
    noLink: 'Your profile link appears once we know your GitHub login. Sign out and in again to refresh it.',
  },
  verified: {
    title: "You're verified",
    line: (university: string) => `You are a verified member of ${university}.`,
    next: 'Go to your home',
  },
} as const;

export const homeCopy = {
  meta: { title: 'Home' },
  title: (login: string | null) => (login ? `Welcome, @${login}` : 'Welcome'),
  verifiedAt: (university: string) => `Verified at ${university}.`,
  members: (count: number) => (count === 1 ? 'You are the first verified member here.' : `${count} verified members so far.`),
  toolsTitle: 'Try the tools',
  toolsLine: 'Every day-one tool works right now, on live GitHub data.',
  toolsLink: 'Open the tools',
} as const;

export const vouchCopy = {
  waiting: (login: string, university: string) => `@${login} is waiting for members of ${university} to vouch for them.`,
  button: (login: string) => `Vouch for @${login}`,
  hint: 'Only vouch if you know this person studies at your university.',
  done: 'Thank you. Your vouch is recorded.',
} as const;
