export const authCopy = {
  signIn: 'Sign in with GitHub',
  signOut: 'Sign out',
  signedInAs: (login: string) => `Signed in as @${login}`,
  signedIn: 'Signed in',
  reconnect: 'Your GitHub sign-in has expired. Sign in again to keep your data fresh.',
  errors: {
    signInRequired: 'Please sign in to continue.',
    suspended: 'This account is suspended. Use the feedback form if you think this is a mistake.',
    verifyFirst: 'Verify your university to use this.',
    notAllowed: "You don't have access to that.",
    signInFailed: "We couldn't sign you in. Please try again.",
    providerUnavailable: 'GitHub sign-in is not available right now. Please try again in a moment.',
  },
} as const;
