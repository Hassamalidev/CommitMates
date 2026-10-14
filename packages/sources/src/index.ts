export type { SourceContext, SourceModule, SyncCounts } from './contract';
export { runSourceSync, type RunSourceOptions, type SourceSyncResult } from './runner';
export { linguistSource } from './linguist/source';
export { normalizeLinguist, type LanguageItem, type LinguistItem, type LinguistRaw, type PatternItem } from './linguist/normalize';
export { createPathMatcher, type PathMatcher, type PathPattern } from './linguist/match';
export { compileRe2, re2Matches, type RE2JS } from './linguist/regex';
export { exploreSource } from './explore/source';
export { TOPIC_SLUG, normalizeExplore, parseTopicFile, type ExploreItem, type ExploreRaw, type TopicItem } from './explore/normalize';
export {
  isManifestFile,
  manifestEcosystem,
  normalizePypiName,
  parseManifest,
  type Dependency,
  type Ecosystem,
  type ParsedManifest,
} from './manifests/parsers';
export { enrichPackage, findStalePackages, type EnrichOptions, type EnrichResult, type PackageRef } from './registries/enrich';
export { deriveTags, loadAliasMap, normalizeTag, type AliasMap } from './registries/tags';
export { githubRepoFromUrl, registryClientFor, type RegistryMeta } from './registries/clients';
export { withRegistryPace } from './registries/pacer';
export {
  isNonPlace,
  lookupLocation,
  normalizeLocation,
  queueLocation,
  resolvePendingLocations,
  timezoneAt,
  type GeocodeRow,
  type ResolveOptions,
  type ResolveReport,
} from './geocoder/geocoder';
export { normalizeGitleaks, type GitleaksItem, type GlobalAllowlistItem, type SecretRuleItem } from './gitleaks/normalize';
export { gitleaksSource } from './gitleaks/source';
export { loadStopwords, normalizeStopwords, stopwordsSource, type StopwordItem } from './stopwords/source';
