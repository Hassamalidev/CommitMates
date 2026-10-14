export const errorsCopy = {
  notFound: {
    metaTitle: 'Page not found',
    title: 'We could not find that page',
    line: 'The link may be old, or the page may have moved.',
    action: 'Back to home',
    companionLabel: 'The companion looks puzzled',
  },
  failure: {
    title: 'Something broke on our side',
    line: 'We have logged it. Trying again usually works.',
    reference: (digest: string) => `Reference: ${digest}`,
    retry: 'Try again',
    home: 'Back to home',
    companionLabel: 'The companion hit an error',
  },
} as const;
