import { getCachedToolResult, getProfileOwner, isPublicProfile, loginSchema } from '@commitmates/core';
import { renderStill, speciesFor, type CompanionInput } from '@commitmates/ui';
import { ImageResponse } from 'next/og';

import { shareCopy } from '@/copy/share';
import { brandCompanion } from '@/lib/brand';
import { companionFor, parseDevCard } from '@/lib/dev-card';
import { OG_COLORS, OG_SIZE } from '@/lib/og-theme';
import { siteName } from '@/lib/site';
import { ogFonts } from '@/server/og-fonts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Seconds a share image may be cached: short, so a profile made private stops being shared soon. */
const MAX_AGE_SECONDS = 600;
/** Companion size on the image (CLAUDE.md §9.7). */
const COMPANION_PX = 240;
const NOT_FOUND = 404;

const notFound = () => new Response('Not found', { status: NOT_FOUND, headers: { 'Cache-Control': 'no-store' } });

const svgDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/**
 * Share images (CLAUDE.md §9.7). Only members whose profile is public get one; for anyone
 * else the image does not exist, exactly like their profile page.
 */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  const { kind } = await context.params;
  if (kind !== 'dev-card') return notFound();

  const login = loginSchema.safeParse(new URL(request.url).searchParams.get('login') ?? '');
  if (!login.success) return notFound();
  const owner = await getProfileOwner(login.data);
  if (!owner || !isPublicProfile(owner)) return notFound();

  const card = parseDevCard(await getCachedToolResult('dev-card', { login: owner.login }));
  // Before the first card exists the image still shows the member, with a companion seeded the same way.
  const companion: CompanionInput = card
    ? companionFor(card)
    : { ...brandCompanion, seed: owner.githubId, species: speciesFor(owner.login), stage: 0 };
  const stats = card
    ? [
        { label: shareCopy.devCard.longestStreak, value: shareCopy.devCard.days(card.metrics.longestStreak) },
        { label: shareCopy.devCard.activeDays, value: shareCopy.devCard.days(card.metrics.activeDays90) },
        { label: shareCopy.devCard.total, value: card.metrics.total365.toLocaleString('en') },
      ]
    : [];
  const name = card?.name ?? `@${owner.login}`;

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 320 }}>
          <img
            src={svgDataUri(renderStill(companion, { surfaceHex: OG_COLORS.bg, accentHex: OG_COLORS.accent }))}
            width={COMPANION_PX}
            height={COMPANION_PX}
            alt=""
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, paddingLeft: 32 }}>
          <div style={{ fontFamily: 'Pixelify Sans', fontSize: 64, lineHeight: 1.1 }}>{name}</div>
          <div style={{ fontSize: 30, color: OG_COLORS.textMuted, marginTop: 8 }}>{`@${owner.login}`}</div>
          <div style={{ display: 'flex', marginTop: 40, gap: 24 }}>
            {stats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  border: `2px solid ${OG_COLORS.borderStrong}`,
                  backgroundColor: OG_COLORS.surface,
                  padding: '16px 20px',
                  borderRadius: 16,
                }}
              >
                <div style={{ fontSize: 22, color: OG_COLORS.textMuted }}>{stat.label}</div>
                <div style={{ fontSize: 40, fontWeight: 600, marginTop: 4 }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 48,
            bottom: 36,
            fontFamily: 'Pixelify Sans',
            fontSize: 30,
            color: OG_COLORS.accent,
          }}
        >
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
