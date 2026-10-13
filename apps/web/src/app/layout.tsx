import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { siteCopy } from '@/copy/site';
import { siteName, siteUrl } from '@/lib/site';

import './globals.css';

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl),
    title: { default: siteName, template: `%s · ${siteName}` },
    description: siteCopy.description,
    applicationName: siteName,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
