export type { SourceContext, SourceModule, SyncCounts } from './contract';
export { runSourceSync, type RunSourceOptions, type SourceSyncResult } from './runner';
export { linguistSource } from './linguist/source';
export { normalizeLinguist, type LanguageItem, type LinguistItem, type LinguistRaw, type PatternItem } from './linguist/normalize';
export { createPathMatcher, type PathMatcher, type PathPattern } from './linguist/match';
export { compileRe2, re2Matches } from './linguist/regex';
