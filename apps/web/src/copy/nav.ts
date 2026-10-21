export const navCopy = {
  mainLabel: 'Main',
  footerLabel: 'Footer',
  skipToContent: 'Skip to content',
  homeLabel: (siteName: string) => `${siteName} home`,
  links: {
    tools: 'Tools',
    how: 'How it works',
    faq: 'FAQ',
  },
  footer: {
    attribution: 'Attribution',
    privacy: 'Privacy',
    terms: 'Terms',
    status: 'Status',
    note: 'No AI, no ads, no selling data.',
    optout: 'Opt out of the index',
  },
} as const;
