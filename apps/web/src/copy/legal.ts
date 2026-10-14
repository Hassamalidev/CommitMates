export const legalCopy = {
  updated: (date: string) => `Last updated ${date}`,
  draftNote:
    'This is the first version of this page. It describes how the service works today and will be finalized before public launch.',
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
          'Our tools read public data only: public repositories, public activity and public profile fields. If you have chosen on GitHub to show private contribution counts, those counts (never the code) are included in your own results.',
        ],
      },
      {
        title: 'What we store about members',
        paragraphs: [
          'Your GitHub id, username, display name and avatar address; your profile choices (university, department, graduation year, timezone, visibility, learning goals, bio); and what you create here, such as messages and listings.',
          'Your GitHub access token is stored encrypted and is used only to run your own analyses on your own rate limit.',
          'Your university email is kept only until verification succeeds. After that we keep the university, not the address.',
        ],
      },
      {
        title: 'People who have not signed up',
        paragraphs: [
          'If someone analyzes a GitHub account that is not a member, the result is shown to them only, is never given a public page, and is never ranked. The cached raw data is deleted within a day. Only anonymous statistics remain, and they cannot be linked back to a person.',
        ],
      },
      {
        title: 'What we never do',
        paragraphs: [
          'We do not use AI or language models. We do not show ads. We do not sell or share your data. We do not store IP addresses; rate limiting uses a salted hash that is discarded daily.',
          'If a scan of your own repositories finds a leaked secret, only you see it, and the secret itself is never stored.',
        ],
      },
      {
        title: 'Your controls',
        paragraphs: [
          'You can change who sees your profile, turn on ghost mode, export everything we hold about you as a JSON file, and delete your account. Deletion is permanent: your rows are removed, not hidden.',
        ],
      },
      {
        title: 'Services we rely on',
        paragraphs: [
          'The site is hosted on Vercel and the database, sign-in and realtime messaging run on Supabase. Verification emails are sent through an email provider. Location text from public profiles may be looked up with OpenStreetMap Nominatim to find a timezone.',
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
          'Anyone can use the public tools. Campus features are for students, alumni and staff who have verified their university. You need a GitHub account to sign in, and you must follow GitHub\'s own terms.',
        ],
      },
      {
        title: 'How to behave',
        paragraphs: [
          'Be respectful. No harassment, spam or impersonation. Do not try to verify a university you do not belong to, and do not use the tools to pressure or shame other people.',
          'Reports are reviewed by moderators. Accounts that break these rules can be limited, suspended or removed.',
        ],
      },
      {
        title: 'What the results mean',
        paragraphs: [
          'Scores and reports are computed from public activity. They cannot see design work, writing, meetings or anything outside a repository, so treat them as one signal, not a judgment of a person.',
          'The service is provided as is, without warranty. It is a free, non-commercial project and may change or pause.',
        ],
      },
      {
        title: 'Your content',
        paragraphs: [
          'What you write here stays yours. You give us permission to store and show it to the people you chose to share it with, and nothing more.',
        ],
      },
      {
        title: 'Other people\'s projects',
        paragraphs: [
          'Listings of inactive projects are a way to ask, not a license to take. A repository without a license cannot be reused freely; ask its owner first.',
        ],
      },
    ],
  },
  attribution: {
    metaTitle: 'Attribution',
    title: 'Attribution',
    intro: 'CommitMates stands on open data and open-source software. These are the sources and assets it uses.',
    dataTitle: 'Data sources',
    assetsTitle: 'Fonts and icons',
    softwareTitle: 'Software',
    softwareLine:
      'The application is built with open-source libraries under MIT, Apache-2.0, BSD, ISC, MPL-2.0 and similar permissive licenses. The full list with each license will be published here before launch.',
    licenseLabel: 'License',
    data: [
      {
        name: 'GitHub REST and GraphQL APIs',
        use: 'Public profiles, repositories and activity.',
        license: 'GitHub Terms of Service',
        href: 'https://docs.github.com/en/rest',
      },
      {
        name: 'GitHub Linguist',
        use: 'Language colors, file extensions, and vendored and documentation path rules.',
        license: 'MIT',
        href: 'https://github.com/github-linguist/linguist',
      },
      {
        name: 'github/explore',
        use: 'Topic names, aliases and related topics.',
        license: 'CC BY 4.0, © GitHub, Inc.',
        href: 'https://github.com/github/explore',
      },
      {
        name: 'npm, PyPI, crates.io, pub.dev and Packagist',
        use: 'Keywords, classifiers and categories that packages publish about themselves.',
        license: 'Terms of use of each registry',
        href: 'https://docs.npmjs.com/policies/open-source-terms',
      },
      {
        name: 'gitleaks',
        use: 'Secret-detection rules used to warn members about keys left in their own repositories.',
        license: 'MIT',
        href: 'https://github.com/gitleaks/gitleaks',
      },
      {
        name: 'stopwords-iso',
        use: 'Lists of common words left out when finding keyphrases.',
        license: 'MIT',
        href: 'https://github.com/stopwords-iso/stopwords-iso',
      },
      {
        name: 'Hipo university-domains-list',
        use: 'The list of universities and their email domains used to verify members.',
        license: 'MIT',
        href: 'https://github.com/Hipo/university-domains-list',
      },
      {
        name: 'disposable-email-domains',
        use: 'Throwaway email domains that cannot be used to verify a university.',
        license: 'CC0 1.0',
        href: 'https://github.com/disposable-email-domains/disposable-email-domains',
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
      'Every companion on this site is generated by our own code from a number. None is hand-drawn, and none is based on another product\'s characters.',
  },
} as const;

/** ISO date the legal pages were last revised; shown on each page. */
export const LEGAL_UPDATED = '2026-10-14';
