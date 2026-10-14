export {
  GitHubClient,
  RATE_LIMIT_FRAGMENT,
  githubFor,
  resetGitHubClientState,
  type ClientDeps,
  type Page,
  type Params,
  type RequestOptions,
  type StatsResult,
} from './client';
export {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubServerError,
  GitHubValidationError,
  RateLimitError,
} from './errors';
export { SERVER_IDENTITY, identityKey, type TokenIdentity } from './identity';
export { LOGIN_PATTERN, parseGitHubUrl, type GitHubRef } from './url';
export { ensureBudget, parseRateLimitHeaders, type BudgetResource, type RateLimitState } from './budgets';
export {
  GitHubOrganizationError,
  PROFILE_QUERY,
  fetchProfile,
  type FetchProfileOptions,
  type Profile,
  type ProfileRepo,
} from './queries/profile';
export { fetchPublicEvents, type ActivityEvent, type ActivityKind } from './queries/events';
export { fetchFileText, fetchReadme, listRootEntries, type RootEntry } from './queries/contents';
export { fetchStarredRepos, type StarredRepo } from './queries/starred';
export { fetchBlobText, fetchTree, type Tree, type TreeEntry } from './queries/git';
export {
  fetchCommitFiles,
  fetchContributorStats,
  fetchRepository,
  listCommits,
  type CommitFile,
  type CommitSummary,
  type ContributorStats,
  type Repository,
} from './queries/repos';
