import manifest from '../../package.json' with { type: 'json' };

/** Length of an abbreviated git commit hash. */
const SHORT_SHA_LENGTH = 7;

export type AppVersion = {
  version: string;
  /** Abbreviated commit of the running build, when the host provides one. */
  commit: string | null;
};

/** Version of the running build: the package version plus the deployed commit. */
export function getAppVersion(env: Record<string, string | undefined> = process.env): AppVersion {
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA;
  return {
    version: manifest.version,
    commit: sha ? sha.slice(0, SHORT_SHA_LENGTH) : null,
  };
}
