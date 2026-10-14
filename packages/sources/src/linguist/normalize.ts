import { parse } from 'yaml';
import { z } from 'zod';

import { compileRe2 } from './regex';

export type LinguistRaw = { languages: string; vendor: string; documentation: string };

export type LanguageItem = {
  kind: 'language';
  name: string;
  color: string | null;
  extensions: string[];
  aliases: string[];
};

export type PatternItem = {
  kind: 'pattern';
  patternKind: 'vendored' | 'documentation';
  pattern: string;
  compiledOk: boolean;
};

export type LinguistItem = LanguageItem | PatternItem;

const languageSchema = z.object({
  color: z.string().optional(),
  extensions: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
});
const languagesFileSchema = z.record(z.string(), z.unknown());
const patternsFileSchema = z.array(z.string());

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort();

function normalizeLanguages(text: string): LanguageItem[] {
  const file = languagesFileSchema.parse(parse(text));
  const items: LanguageItem[] = [];
  for (const [name, value] of Object.entries(file)) {
    const language = languageSchema.safeParse(value);
    if (!language.success) continue;
    const color = language.data.color;
    items.push({
      kind: 'language',
      name,
      color: color !== undefined && HEX_COLOR.test(color) ? color.toLowerCase() : null,
      extensions: uniqueSorted((language.data.extensions ?? []).map((extension) => extension.toLowerCase())),
      aliases: uniqueSorted((language.data.aliases ?? []).map((alias) => alias.toLowerCase())),
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePatterns(text: string, patternKind: PatternItem['patternKind']): PatternItem[] {
  const patterns = patternsFileSchema.parse(parse(text));
  return uniqueSorted(patterns).map((pattern) => ({
    kind: 'pattern',
    patternKind,
    pattern,
    compiledOk: compileRe2(pattern) !== null,
  }));
}

/** Pure: turns the three Linguist YAML files into language and path-pattern items. */
export function normalizeLinguist(raw: LinguistRaw): LinguistItem[] {
  return [
    ...normalizeLanguages(raw.languages),
    ...normalizePatterns(raw.vendor, 'vendored'),
    ...normalizePatterns(raw.documentation, 'documentation'),
  ];
}
