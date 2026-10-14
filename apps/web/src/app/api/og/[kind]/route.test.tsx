import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleCompat } from '@/__fixtures__/compat';
import { sampleDevCard } from '@/__fixtures__/dev-card';
import { OG_COLORS } from '@/lib/og-theme';

type Owner = { userId: string; login: string; githubId: number; visibility: string; universityId: null; active: boolean };

const getProfileOwner = vi.fn<(login: string) => Promise<Owner | null>>();
const getCachedDevCard = vi.fn<(login: string) => Promise<unknown>>();
const compatShareAllowed = vi.fn<(a: string, b: string, viewer: string | null) => Promise<boolean>>();
const getCachedCompat = vi.fn<(a: string, b: string) => Promise<unknown>>();
vi.mock('@commitmates/core', async () => {
  const { z } = await import('zod');
  return {
    getProfileOwner,
    getCachedDevCard,
    compatShareAllowed,
    getCachedCompat,
    isPublicProfile: (owner: Owner) => owner.active && owner.visibility === 'public',
    loginSchema: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  };
});
vi.mock('@commitmates/env/client', () => ({
  clientEnv: { NEXT_PUBLIC_SITE_NAME: 'CommitMates', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
}));

const { GET } = await import('./route');

const owner = (overrides: Partial<Owner> = {}): Owner => ({
  userId: 'u1',
  login: 'fixture-user-1',
  githubId: 4242,
  visibility: 'public',
  universityId: null,
  active: true,
  ...overrides,
});

const call = (kind: string, query: string) =>
  GET(new Request(`http://localhost:3000/api/og/${kind}${query}`), { params: Promise.resolve({ kind }) });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

beforeEach(() => {
  getProfileOwner.mockReset();
  getCachedDevCard.mockReset();
  compatShareAllowed.mockReset();
  getCachedCompat.mockReset();
});

describe('GET /api/og/[kind]', () => {
  it('has no image for unknown kinds, invalid logins or people who never signed up', async () => {
    expect((await call('other', '?login=fixture-user-1')).status).toBe(404);
    expect((await call('dev-card', '')).status).toBe(404);
    expect((await call('dev-card', '?login=not%20valid')).status).toBe(404);
    getProfileOwner.mockResolvedValue(null);
    const response = await call('dev-card', '?login=visitor');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(getCachedDevCard).not.toHaveBeenCalled();
  });

  it('has no image for a member whose profile is not public', async () => {
    for (const visibility of ['university', 'country', 'hidden']) {
      getProfileOwner.mockResolvedValue(owner({ visibility }));
      expect((await call('dev-card', '?login=fixture-user-1')).status, visibility).toBe(404);
    }
    getProfileOwner.mockResolvedValue(owner({ active: false }));
    expect((await call('dev-card', '?login=fixture-user-1')).status).toBe(404);
  });

  it('renders a 1200×630 PNG for a public member, briefly cacheable', async () => {
    getProfileOwner.mockResolvedValue(owner());
    getCachedDevCard.mockResolvedValue(sampleDevCard);
    const response = await call('dev-card', '?login=Fixture-User-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('max-age=600');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
    // PNG header: width and height are big-endian at bytes 16–23.
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect(getCachedDevCard).toHaveBeenCalledWith('fixture-user-1');
  });

  it('still renders before the first card exists', async () => {
    getProfileOwner.mockResolvedValue(owner());
    getCachedDevCard.mockResolvedValue(null);
    const response = await call('dev-card', '?login=fixture-user-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });
});

describe('GET /api/og/compat', () => {
  it('exists only when anyone may share the comparison', async () => {
    compatShareAllowed.mockResolvedValue(false);
    getCachedCompat.mockResolvedValue(sampleCompat);
    expect((await call('compat', '?a=alice-dev&b=bob-dev')).status).toBe(404);
    // Crawlers fetch images, so the viewer is never known here.
    expect(compatShareAllowed).toHaveBeenCalledWith('alice-dev', 'bob-dev', null);
    expect((await call('compat', '?a=alice-dev')).status).toBe(404);
    expect((await call('compat', '?a=alice-dev&b=not%20valid')).status).toBe(404);
  });

  it('needs a stored comparison', async () => {
    compatShareAllowed.mockResolvedValue(true);
    getCachedCompat.mockResolvedValue(null);
    expect((await call('compat', '?a=alice-dev&b=bob-dev')).status).toBe(404);
  });

  it('renders a PNG for two public members', async () => {
    compatShareAllowed.mockResolvedValue(true);
    getCachedCompat.mockResolvedValue(sampleCompat);
    const response = await call('compat', '?a=alice-dev&b=bob-dev');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
  });
});

describe('OG_COLORS', () => {
  it('matches the dark theme tokens', () => {
    const css = readFileSync(new URL('../../../../../../../packages/ui/src/tokens.css', import.meta.url), 'utf8');
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf(':root[data-theme="light"]'));
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(dark)?.[1]?.toUpperCase();
    expect(OG_COLORS).toEqual({
      bg: token('bg'),
      surface: token('surface'),
      border: token('border'),
      borderStrong: token('border-strong'),
      text: token('text'),
      textMuted: token('text-muted'),
      accent: token('accent'),
    });
  });
});
