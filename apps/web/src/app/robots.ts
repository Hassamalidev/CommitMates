import type { MetadataRoute } from 'next';

import { PRIVATE_PREFIXES } from '@/lib/seo';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_PREFIXES] },
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
  };
}
