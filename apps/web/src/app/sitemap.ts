import type { MetadataRoute } from 'next';

import { publicPaths } from '@/lib/seo';
import { siteUrl } from '@/lib/site';

/**
 * Public pages only (CLAUDE.md §9.6, P2-T19): the landing page, legal pages and tool pages
 * without inputs. Results about a person and member pages are never listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths().map((path) => ({ url: new URL(path, siteUrl).toString() }));
}
