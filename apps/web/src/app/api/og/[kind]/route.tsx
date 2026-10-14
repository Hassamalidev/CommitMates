import {
  compatShareAllowed,
  getCachedCompat,
  getCachedDevCard,
  getProfileOwner,
  isPublicProfile,
  loginSchema,
} from '@commitmates/core';
import { renderStill, speciesFor, type CompanionInput } from '@commitmates/ui';
import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';

import { compatCopy } from '@/copy/compat';
import { shareCopy } from '@/copy/share';
import { brandCompanion } from '@/lib/brand';
import { companionFor } from '@/lib/dev-card';
import { OG_COLORS, OG_SIZE } from '@/lib/og-theme';
import { siteName } from '@/lib/site';
import { ogFonts } from '@/server/og-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Seconds a share image may be cached: short, so a profile made private stops being shared soon. */
const MAX_AGE_SECONDS = 600;
/** Companion size on a single-person image (CLAUDE.md §9.7); a pair shares the width. */
const COMPANION_PX = 240;
const PAIR_COMPANION_PX = 200;
const NOT_FOUND = 404;

const notFound = () => new Response('Not found', { status: NOT_FOUND, headers: { 'Cache-Control': 'no-store' } });

const companionImage = (companion: CompanionInput, size: number, mirrored = false) => (
  <img
    src={`data:image/svg+xml;base64,${Buffer.from(renderStill(companion, { surfaceHex: OG_COLORS.bg, accentHex: OG_COLORS.accent })).toString('base64')}`}
    width={size}
    height={size}
    alt=""
    style={mirrored ? { transform: 'scaleX(-1)' } : {}}
  />
);

const statBox = (label: string, value: string) => (
  <div
    key={label}
    style={{
      display: 'flex',
      flexDirection: 'column',
      border: `2px solid ${OG_COLORS.borderStrong}`,
      backgroundColor: OG_COLORS.surface,
      padding: '16px 20px',
      borderRadius: 16,
    }}
  >
    <div style={{ fontSize: 22, color: OG_COLORS.textMuted }}>{label}</div>
    <div style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{value}</div>
  </div>
);

/** 1200 × 630 on the dark background with the site name bottom-right (CLAUDE.md §9.7). */
async function image(content: ReactNode): Promise<Response> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: OG_COLORS.bg,
          color: OG_COLORS.text,
          fontFamily: 'Inter',
          padding: 64,
          position: 'relative',
        }}
      >
        {content}
        <div style={{ position: 'absolute', right: 48, bottom: 36, fontFamily: 'Pixelify Sans', fontSize: 30, color: OG_COLORS.accent }}>
          {siteName}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: await ogFonts(),
      headers: { 'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, s-maxage=${MAX_AGE_SECONDS}` },
    },
  );
}

/** A member's Dev Card: only for an active member whose profile is public. */
async function devCardImage(params: URLSearchParams): Promise<Response> {
  const login = loginSchema.safeParse(params.get('login') ?? '');
  if (!login.success) return notFound();
  const owner = await getProfileOwner(login.data);
  if (!owner || !isPublicProfile(owner)) return notFound();

  const card = await getCachedDevCard(owner.login);
  // Before the first card exists the image still shows the member, with a companion seeded the same way.
  const companion: CompanionInput = card
    ? companionFor(card)
    : { ...brandCompanion, seed: owner.githubId, species: speciesFor(owner.login), stage: 0 };
  const stats = card
    ? [
        statBox(shareCopy.devCard.longestStreak, shareCopy.devCard.days(card.metrics.longestStreak)),
        statBox(shareCopy.devCard.activeDays, shareCopy.devCard.days(card.metrics.activeDays90)),
        statBox(shareCopy.devCard.total, card.metrics.total365.toLocaleString('en')),
      ]
    : [];

  return image(
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 320 }}>
        {companionImage(companion, COMPANION_PX)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, paddingLeft: 32 }}>
        <div style={{ fontFamily: 'Pixelify Sans', fontSize: 64, lineHeight: 1.1 }}>{card?.name ?? `@${owner.login}`}</div>
        <div style={{ fontSize: 30, color: OG_COLORS.textMuted, marginTop: 8 }}>{`@${owner.login}`}</div>
        <div style={{ display: 'flex', marginTop: 40, gap: 24 }}>{stats}</div>
      </div>
    </>,
  );
}

/**
 * A comparison: only when anyone may share it, which means both people are public
 * members (an image is fetched by crawlers, never by the person who asked).
 */
async function compatImage(params: URLSearchParams): Promise<Response> {
  const a = loginSchema.safeParse(params.get('a') ?? '');
  const b = loginSchema.safeParse(params.get('b') ?? '');
  if (!a.success || !b.success || !(await compatShareAllowed(a.data, b.data, null))) return notFound();
  const result = await getCachedCompat(a.data, b.data);
  if (!result) return notFound();
  const band = result.band === null ? undefined : compatCopy.bands[result.band];

  return image(
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
        {companionImage(companionFor(result.a), PAIR_COMPANION_PX)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 26, color: OG_COLORS.textMuted }}>{shareCopy.compat.score}</div>
          <div style={{ fontFamily: 'Pixelify Sans', fontSize: 120, color: OG_COLORS.accent, lineHeight: 1 }}>
            {result.score === null ? '–' : String(result.score)}
          </div>
        </div>
        {companionImage(companionFor(result.b), PAIR_COMPANION_PX, true)}
      </div>
      <div style={{ fontFamily: 'Pixelify Sans', fontSize: 52, marginTop: 24 }}>{band?.title ?? compatCopy.fallbackBand.title}</div>
      <div style={{ fontSize: 30, color: OG_COLORS.textMuted, marginTop: 8 }}>{`@${result.a.login} and @${result.b.login}`}</div>
    </div>,
  );
}

/** Share images (CLAUDE.md §9.7). Where sharing is not allowed the image does not exist. */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await context.params;
  const params = new URL(request.url).searchParams;
  if (kind === 'dev-card') return devCardImage(params);
  if (kind === 'compat') return compatImage(params);
  return notFound();
}
