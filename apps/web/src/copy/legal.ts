import type { SyncedSourceName } from '@commitmates/core';

export type Credit = { name: string; use: string; license: string; href: string };

export const legalCopy = {
  updated: (date: string) => `Last updated ${date}`,
  contact: (email: string) => `Questions about this page, or a request about your data: ${email}.`,
  privacy: {
    metaTitle: 'Privacy',
    title: 'Privacy policy',
    intro:
      'CommitMates is built to need as little about you as possible. This page lists what we store, why, for how long, and how you remove it.',
    sections: [
      {
        title: 'What we read from GitHub',
        paragraphs: [
          'When you sign in, we ask GitHub for two read-only permissions: your public profile and your email address. We never ask for access to private repositories and we cannot write to your account.',
          'Our tools read public data only: public profiles, public repositories and their files, and public activity from the last 90 days. If you have chosen on GitHub to show private contribution counts, those counts (never the code) are included in your own results.',
          'Commit messages and other activity are read to compute a result and are not stored, except a few short, common messages (like “fix typo”) counted without any name, repository or date attached.',
        ],
      },
      {
        title: 'What we store about members',
        paragraphs: [
          'Your account: GitHub id, username, display name and avatar address, and your GitHub access token, stored encrypted and used only to run your own analyses on your own rate limit.',
          'Your profile: university, role (student, alumni or supervisor), department, graduation year, timezone, learning goals, bio, who can see your profile, and your notification choices.',
          'What you create: message requests and conversations, blocks and reports, shared streaks, project listings and adoptions, review requests, reviews and the credits they move, skill-swap offers and wants, showcased projects, questions to alumni, events and teams, final-year project ideas and past projects, and feedback.',
          'What we compute from your public activity: your Dev Card, skill tags, daily partner suggestions and a trust score that sets how many new conversations you can start each day. These are recomputed and deleted with your account.',
        ],
      },
      {
        title: 'Who sees what',
        paragraphs: [
          'You choose who sees your profile: your university, people in your country, everyone, or nobody. Ghost mode keeps you out of partner suggestions and out of the lists of people others can ask for help. People you block cannot send you requests or messages and are never suggested to you.',
          'You appear on a members leaderboard only if you opt in. University and department boards show totals, never individual members.',
          'If a scan of your own repositories finds a leaked key, only you see where it is, and the key itself is never stored.',
          'Moderators see a reported message and the messages around it only while handling that report, and each such view is logged.',
        ],
      },
      {
        title: 'Your university email',
        paragraphs: [
          'We send a six-digit code to your university address and store only a hash of the code. Once you are verified we keep the university, not the address.',
          'Other emails (the optional daily digest and account notices) go to the email address of your GitHub sign-in, read when each email is sent.',
        ],
      },
      {
        title: 'People who have not signed up',
        paragraphs: [
          'If someone analyzes a GitHub account that is not a member, the result is shown to them only, is never given a public page, and is never ranked. The cached data is deleted within a day. Only anonymous statistics remain, and they cannot be linked back to a person.',
          'To help members find projects and developers near them, we keep a small index of public GitHub accounts by country: the username and id, and basic facts about some of their public repositories (name, description, topics, language and stars). It is shown only as links to GitHub, never with a page here, a ranking or a way to send a message. Anyone can remove their account from it, for good, on the opt-out page.',
        ],
      },
      {
        title: 'What we never do',
        paragraphs: [
          'We do not use AI or language models. We do not show ads. We do not sell or share your data.',
          'We do not store IP addresses. Rate limits and anonymous usage counts use a hash of the address with a salt that is replaced every day, so it cannot be traced back or linked across days.',
        ],
      },
      {
        title: 'How long we keep it',
        paragraphs: [
          'Member data is kept until you delete your account. Results about people who have not signed up are kept for at most a day. Anonymous statistics, which hold no account, are kept.',
          'An administrative log records actions such as moderation decisions. When an account is deleted, the log keeps only a one-way hash of its id.',
        ],
      },
      {
        title: 'Your controls',
        paragraphs: [
          'On your privacy settings page you can change who sees your profile, turn on ghost mode, download everything we hold about you as one JSON file, and delete your account.',
          'Deletion is permanent: your rows are removed, not hidden. In conversations with others your messages are replaced by one note saying a member left, shared streaks end and your partners are told, and feedback you sent stays without your name. To also revoke our access on GitHub, remove CommitMates under GitHub’s Settings → Applications.',
        ],
      },
      {
        title: 'Services we rely on',
        paragraphs: [
          'The site runs on Vercel, and the database, sign-in and realtime messaging run on Supabase. Emails are sent through a transactional email provider. Location text from public profiles, without the username or anything else, may be looked up with OpenStreetMap Nominatim to find a city and timezone.',
          'Error reports are off unless we turn on Sentry. When on, a report carries the error and the page it happened on, never your account, cookies, messages or form contents.',
        ],
      },
    ],
  },
  terms: {
    metaTitle: 'Terms',
    title: 'Terms of use',
    intro: 'These terms keep CommitMates safe and fair for everyone who uses it.',
    sections: [
      {
        title: 'Who can use it',
        paragraphs: [
          'Anyone can use the public tools. Campus features are for students, alumni and staff who have verified their university. You need a GitHub account to sign in, and you must follow GitHub’s own terms.',
        ],
      },
      {
        title: 'How to behave',
        paragraphs: [
          'Be respectful. No harassment, spam or impersonation. Do not try to verify a university you do not belong to, vouch for someone you do not know, or use the tools to pressure or shame other people.',
          'Members can block and report anyone. Moderators review reports and can dismiss them, warn, suspend for a time, or ban. An account reported by several verified members is hidden until a moderator looks at it. You can appeal through the feedback form.',
        ],
      },
      {
        title: 'What the results mean',
        paragraphs: [
          'Scores and reports are computed from public activity. They cannot see design work, writing, meetings or anything outside a repository, so treat them as one signal, not a judgment of a person.',
          'Review credits, streaks, badges and leaderboard places have no money value and cannot be sold or exchanged outside CommitMates.',
          'The service is provided as is, without warranty. It is a free, non-commercial project and may change or pause.',
        ],
      },
      {
        title: 'Your content',
        paragraphs: [
          'What you write here stays yours. You give us permission to store it and show it to the people you chose to share it with, and nothing more. Delete your account and it is removed.',
        ],
      },
      {
        title: 'Other people’s projects',
        paragraphs: [
          'Listings of inactive projects are a way to ask, not a license to take. A repository without a license cannot be reused freely; ask its owner first. Reviews happen on GitHub, under GitHub’s rules and the project’s own.',
        ],
      },
      {
        title: 'Changes',
        paragraphs: ['When these terms or the privacy policy change, the date at the top of the page changes with them.'],
      },
    ],
  },
  attribution: {
    metaTitle: 'Attribution',
    title: 'Attribution',
    intro: 'CommitMates stands on open data and open-source software. These are the sources, assets and packages it uses.',
    dataTitle: 'Data sources',
    assetsTitle: 'Fonts and icons',
    softwareTitle: 'Software',
    softwareLine: (count: number) =>
      `The site ships ${count} open-source packages. Each is listed below with its license; every license is on our allow-list of permissive licenses.`,
    softwareCaption: 'Open-source packages in the site, with their licenses',
    packageHeading: 'Package',
    licenseLabel: 'License',
    syncedOn: (date: string) => `Last synced ${date}.`,
    notSynced: 'Not synced yet.',
    data: [
      {
        name: 'GitHub REST and GraphQL APIs',
        use: 'Public profiles, repositories and activity.',
        license: 'GitHub Terms of Service',
        href: 'https://docs.github.com/en/rest',
      },
      {
        name: 'npm, PyPI, crates.io, pub.dev and Packagist',
        use: 'Keywords, classifiers and categories that packages publish about themselves.',
        license: 'Terms of use of each registry',
        href: 'https://docs.npmjs.com/policies/open-source-terms',
      },
      {
        name: 'OpenStreetMap Nominatim',
        use: 'Turning the location text of a public profile into a city, country and timezone.',
        license: 'Data © OpenStreetMap contributors, ODbL 1.0',
        href: 'https://www.openstreetmap.org/copyright',
      },
      {
        name: 'tz-lookup and timezone-boundary-builder',
        use: 'Finding the timezone of a coordinate without a network call.',
        license: 'CC0 1.0; boundaries derived from OpenStreetMap data, ODbL 1.0',
        href: 'https://github.com/photostructure/tz-lookup',
      },
    ],
    /** One credit per synced source, keyed by the name its snapshots carry; the type requires every one. */
    synced: {
      linguist: {
        name: 'GitHub Linguist',
        use: 'Language colors, file extensions, and vendored and documentation path rules.',
        license: 'MIT',
        href: 'https://github.com/github-linguist/linguist',
      },
      explore: {
        name: 'github/explore',
        use: 'Topic names, aliases and related topics.',
        license: 'CC BY 4.0, © GitHub, Inc.',
        href: 'https://github.com/github/explore',
      },
      gitleaks: {
        name: 'gitleaks',
        use: 'Secret-detection rules used to warn members about keys left in their own repositories.',
        license: 'MIT',
        href: 'https://github.com/gitleaks/gitleaks',
      },
      stopwords: {
        name: 'stopwords-iso',
        use: 'Lists of common words left out when finding keyphrases.',
        license: 'MIT',
        href: 'https://github.com/stopwords-iso/stopwords-iso',
      },
      hipo: {
        name: 'Hipo university-domains-list',
        use: 'The list of universities and their email domains used to verify members.',
        license: 'MIT',
        href: 'https://github.com/Hipo/university-domains-list',
      },
      disposable_emails: {
        name: 'disposable-email-domains',
        use: 'Throwaway email domains that cannot be used to verify a university.',
        license: 'CC0 1.0',
        href: 'https://github.com/disposable-email-domains/disposable-email-domains',
      },
    } satisfies Record<SyncedSourceName, Credit>,
    assets: [
      { name: 'Inter', use: 'Body text.', license: 'SIL Open Font License 1.1', href: 'https://rsms.me/inter/' },
      {
        name: 'Pixelify Sans',
        use: 'Headings.',
        license: 'SIL Open Font License 1.1',
        href: 'https://fonts.google.com/specimen/Pixelify+Sans',
      },
      {
        name: 'JetBrains Mono',
        use: 'Code and terminal text.',
        license: 'SIL Open Font License 1.1',
        href: 'https://www.jetbrains.com/lp/mono/',
      },
      {
        name: 'Material Symbols',
        use: 'Interface icons.',
        license: 'Apache-2.0',
        href: 'https://fonts.google.com/icons',
      },
    ],
    companions:
      'Every companion on this site is generated by our own code from a number. None is hand-drawn, and none is based on another product’s characters.',
  },
} as const;

/** ISO date the legal pages were last revised; shown on each page. */
export const LEGAL_UPDATED = '2026-11-04';
