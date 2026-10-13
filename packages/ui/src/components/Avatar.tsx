import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type AvatarProps = {
  /** A GitHub avatar URL. Only `avatars.githubusercontent.com` is ever rendered (CLAUDE.md §10.8). */
  src: string | null;
  /** The person's name or login, used as the image's text alternative. */
  alt: string;
  size?: 32 | 40 | 64 | 96;
  /** Shown when there is no usable image, normally a companion. */
  fallback: ReactNode;
  className?: string;
};

const AVATAR_HOST = 'avatars.githubusercontent.com';

/** Appends GitHub's size parameter so the image arrives at twice its display size, not full size. */
export function sizedAvatarUrl(src: string | null, size: number): string | null {
  if (src === null) return null;
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST) return null;
    url.searchParams.set('s', String(size * 2));
    return url.toString();
  } catch {
    return null;
  }
}

/** A GitHub avatar in a pixel-border frame; falls back to the given node. */
export function Avatar({ src, alt, size = 40, fallback, className }: AvatarProps) {
  const url = sizedAvatarUrl(src, size);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border-2 border-line-strong bg-surface-2',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? (
        // A plain img: images are served unoptimized, at the size requested from GitHub (ADR-001).
        <img src={url} alt={alt} width={size} height={size} loading="lazy" decoding="async" />
      ) : (
        fallback
      )}
    </span>
  );
}
