import { schema, type DbOrTx } from '@commitmates/db';

/** Longest tag kept; longer strings are sentences, not tags. */
const MAX_TAG_LENGTH = 50;

/**
 * Tag normalization (CLAUDE.md §6.6): lowercase; spaces, underscores, slashes, dots and
 * colons become hyphens; anything else outside `a-z 0-9 + # -` is dropped.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .toLowerCase()
    .trim()
    .replace(/[\s_/.:]+/g, '-')
    .replace(/[^a-z0-9+#-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return tag === '' || tag.length > MAX_TAG_LENGTH ? null : tag;
}

const TOPIC_CLASSIFIER = /^Topic\s*::/i;

/** The leaf of a `Topic ::` trove classifier, e.g. `Topic :: Scientific/Engineering :: Image Recognition` → `Image Recognition`. */
export function classifierLeaf(classifier: string): string | null {
  if (!TOPIC_CLASSIFIER.test(classifier)) return null;
  const leaf = classifier.split('::').at(-1)?.trim();
  return leaf === undefined || leaf === '' ? null : leaf;
}

/** The last segment of a `::`-separated category slug (crates.io), e.g. `no-std::no-alloc` → `no-alloc`. */
const categoryLeaf = (category: string) => category.split('::').at(-1) ?? category;

/** alias → canonical topic slug, so `reactjs` and `react` become one tag. */
export type AliasMap = ReadonlyMap<string, string>;

export async function loadAliasMap(db: DbOrTx): Promise<AliasMap> {
  const rows = await db.select({ slug: schema.topics.slug, aliases: schema.topics.aliases }).from(schema.topics);
  const map = new Map<string, string>();
  for (const row of rows) {
    for (const alias of row.aliases) map.set(alias, row.slug);
  }
  // A slug always maps to itself, even if another topic lists it as an alias.
  for (const row of rows) map.set(row.slug, row.slug);
  return map;
}

export type TagSources = {
  keywords: readonly string[];
  classifiers: readonly string[];
  categories?: readonly string[];
  ghTopics: readonly string[];
};

/** The normalized union of keywords, classifier leaves, categories and GitHub topics, mapped through aliases. */
export function deriveTags(sources: TagSources, aliases: AliasMap): string[] {
  const raw = [
    ...sources.keywords,
    ...sources.classifiers.map(classifierLeaf).filter((leaf): leaf is string => leaf !== null),
    ...(sources.categories ?? []).map(categoryLeaf),
    ...sources.ghTopics,
  ];
  const tags = new Set<string>();
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (tag !== null) tags.add(aliases.get(tag) ?? tag);
  }
  return [...tags].sort();
}
