import { clientEnv } from '@commitmates/env/client';

/** Display name of the site. Rename the product through `NEXT_PUBLIC_SITE_NAME` (CLAUDE.md §0). */
export const siteName = clientEnv.NEXT_PUBLIC_SITE_NAME;

export const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL;
