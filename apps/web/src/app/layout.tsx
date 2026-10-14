import { THEME_INIT_SCRIPT } from '@commitmates/ui';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Pixelify_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { siteCopy } from '@/copy/site';
import { siteName, siteUrl } from '@/lib/site';

import './globals.css';

// All three are OFL-1.1 and are downloaded at build time, then served from our own origin (CLAUDE.md §3.1).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const pixelify = Pixelify_Sans({ subsets: ['latin'], variable: '--font-pixelify', display: 'swap', weight: ['500'] });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl),
    title: { default: siteName, template: `%s · ${siteName}` },
    description: siteCopy.description,
    applicationName: siteName,
    icons: { icon: [{ url: '/brand-icon', type: 'image/svg+xml' }] },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Dark first; the inline script switches to the stored or system theme before first paint.
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${pixelify.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas text-fg antialiased">{children}</body>
    </html>
  );
}
