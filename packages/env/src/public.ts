/**
 * Browser-safe values that are read without zod, so a client bundle that needs only the
 * site name does not ship the validator. `assertServerEnv()` still validates every
 * variable at startup; these accessors only apply the same local fallbacks.
 */
export const CLIENT_FALLBACKS = {
  NEXT_PUBLIC_SITE_NAME: 'CommitMates',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
} as const;

/** Display name of the site (`NEXT_PUBLIC_SITE_NAME`, referenced literally so Next.js inlines it). */
export function publicSiteName(): string {
  const name = process.env.NEXT_PUBLIC_SITE_NAME;
  // An empty value is as unusable as a missing one, matching the client schema's `min(1)`.
  return name !== undefined && name !== '' ? name : CLIENT_FALLBACKS.NEXT_PUBLIC_SITE_NAME;
}
