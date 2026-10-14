export const privacyCenterCopy = {
  meta: { title: 'Privacy and data' },
  title: 'Privacy and data',
  intro: 'Decide who sees you, take a copy of your data, or delete your account.',
  visibility: {
    title: 'Who can see your profile',
    legend: 'Profile visible to',
    options: {
      university: 'Members of my university',
      country: 'Members of universities in my country',
      public: 'Anyone',
      hidden: 'Only me',
    },
    ghost: 'Ghost mode: leave me out of suggestions and searches for now',
    save: 'Save',
    saved: 'Saved.',
  },
  export: {
    title: 'Your data',
    line: 'Download everything we keep about you, as one JSON file.',
    link: 'Download my data',
  },
  delete: {
    title: 'Delete your account',
    line: 'This deletes your profile, verification, messages and everything else we keep about you. It cannot be undone.',
    github: 'To also remove our access to your GitHub account, revoke it in your GitHub settings under Applications:',
    githubLink: 'GitHub authorized applications',
    confirm: (phrase: string) => `Type ${phrase} to confirm`,
    submit: 'Delete my account',
  },
} as const;
