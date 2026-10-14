import { parse } from 'yaml';
import { z } from 'zod';

export type ExploreFile = { slug: string; sha: string; content: string };

export type ExploreRaw = {
  treeSha: string;
  /** Files fetched in this run: new or changed since the last sync. */
  files: ExploreFile[];
  /** Every topic slug present upstream, for removing topics that were deleted. */
  presentSlugs: string[];
  /** Changed files not fetched in this run. */
  remaining: number;
};

export type TopicItem = {
  kind: 'topic';
  slug: string;
  displayName: string;
  aliases: string[];
  related: string[];
  blobSha: string;
};
/** A file whose front matter could not be used. */
export type InvalidItem = { kind: 'invalid'; slug: string };
/** The full upstream listing, carried through so the sync can delete removed topics. */
export type PresenceItem = { kind: 'presence'; slugs: string[] };
export type ExploreItem = TopicItem | InvalidItem | PresenceItem;

/** GitHub topic slugs: lowercase letters, digits and hyphens. */
export const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]*$/;

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const frontMatterSchema = z.object({
  topic: z.string(),
  display_name: z.string().min(1),
  aliases: z.string().nullish(),
  related: z.string().nullish(),
});

/** `aliases` and `related` are comma-separated strings upstream (CLAUDE.md §6.2). */
function splitList(value: string | null | undefined, self: string): string[] {
  if (!value) return [];
  const slugs = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => TOPIC_SLUG.test(entry) && entry !== self);
  return [...new Set(slugs)].sort();
}

/** Parses one `topics/<slug>/index.md`. Returns `null` when the front matter is unusable. */
export function parseTopicFile(file: ExploreFile): TopicItem | null {
  const match = FRONT_MATTER.exec(file.content);
  if (!match?.[1]) return null;
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch {
    return null;
  }
  const front = frontMatterSchema.safeParse(data);
  if (!front.success) return null;
  // The directory name is the slug GitHub uses; a mismatching `topic` field means a broken file.
  if (front.data.topic.trim().toLowerCase() !== file.slug || !TOPIC_SLUG.test(file.slug)) return null;
  return {
    kind: 'topic',
    slug: file.slug,
    displayName: front.data.display_name.trim(),
    aliases: splitList(front.data.aliases, file.slug),
    related: splitList(front.data.related, file.slug),
    blobSha: file.sha,
  };
}

/** Pure: fetched files become topic or invalid items, plus the upstream listing. */
export function normalizeExplore(raw: ExploreRaw): ExploreItem[] {
  const items: ExploreItem[] = raw.files.map((file) => parseTopicFile(file) ?? { kind: 'invalid', slug: file.slug });
  items.push({ kind: 'presence', slugs: [...raw.presentSlugs].sort() });
  return items;
}
