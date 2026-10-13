export type GitHubRef = { owner: string; repo: string; number?: number };

// GitHub's own rules: logins are alphanumeric with single inner hyphens, up to 39 characters;
// repository names allow letters, digits, dot, hyphen and underscore, up to 100 characters.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const NUMBER = /^[1-9]\d{0,9}$/;
/** Path segments after owner/repo that carry an issue or pull request number. */
const NUMBERED_SEGMENTS = new Set(['pull', 'issues']);

export const LOGIN_PATTERN = OWNER;

function build(owner: string, repoRaw: string, rest: readonly string[]): GitHubRef | null {
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  const [segment, value] = rest;
  if (segment !== undefined && NUMBERED_SEGMENTS.has(segment) && value !== undefined && NUMBER.test(value)) {
    return { owner, repo, number: Number(value) };
  }
  return { owner, repo };
}

/**
 * The only way a user-supplied link becomes a request (CLAUDE.md §5.6, §5.10): accepts
 * `https://github.com/o/r`, `/tree/…`, `/pull/<n>`, `/issues/<n>`, a `.git` suffix and
 * `o/r` shorthand. Anything else, including other hosts, returns `null`.
 */
export function parseGitHubUrl(input: string): GitHubRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (!trimmed.includes('://') && !trimmed.startsWith('github.com/') && !trimmed.startsWith('www.github.com/')) {
    const parts = trimmed.split('/');
    const [owner, repo] = parts;
    if (parts.length !== 2 || !owner || !repo) return null; // allowed-literal: owner/repo shorthand has two parts
    return build(owner, repo, []);
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  if (url.username !== '' || url.password !== '' || url.port !== '') return null;

  const [owner, repo, ...rest] = url.pathname.split('/').filter((segment) => segment !== '');
  if (!owner || !repo) return null;
  return build(owner, repo, rest);
}
