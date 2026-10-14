import { parseGitHubUrl } from '@commitmates/github';
import { z } from 'zod';

import type { Ecosystem } from '../manifests/parsers';

export type RegistryMeta = {
  keywords: string[];
  classifiers: string[];
  /** crates.io categories; other registries have none. */
  categories: string[];
  /** `owner/repo` on GitHub when the registry names one. */
  repoFullName: string | null;
};

export type RegistryClient = {
  /** Pacing key: calls to the same registry are spaced app-wide. */
  registry: string;
  url(name: string): string;
  parse(body: unknown, name: string): RegistryMeta;
};

const strings = z.array(z.string()).nullish();

/** Turns a repository URL from registry metadata into `owner/repo`, or `null` if it is not on GitHub. */
export function githubRepoFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleaned = url
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/');
  const ref = parseGitHubUrl(cleaned);
  return ref ? `${ref.owner}/${ref.repo}` : null;
}

/** Go module paths under github.com name their repository directly. */
export function githubRepoFromGoModule(modulePath: string): string | null {
  const match = /^github\.com\/([^/]+)\/([^/]+)/.exec(modulePath);
  if (!match?.[1] || !match[2]) return null;
  const ref = parseGitHubUrl(`${match[1]}/${match[2]}`);
  return ref ? `${ref.owner}/${ref.repo}` : null;
}

const splitKeywords = (value: string | readonly string[] | null | undefined): string[] => {
  if (!value) return [];
  const list = typeof value === 'string' ? value.split(/[,\s]+/) : [...value];
  return list.map((entry) => entry.trim()).filter((entry) => entry !== '');
};

const npmSchema = z.object({
  keywords: z.union([strings, z.string()]).nullish(),
  repository: z.union([z.string(), z.object({ url: z.string().nullish() })]).nullish(),
});

const pypiSchema = z.object({
  info: z.object({
    keywords: z.union([z.string(), strings]).nullish(),
    classifiers: strings,
    project_urls: z.record(z.string(), z.string().nullable()).nullish(),
    home_page: z.string().nullish(),
  }),
});

const cratesSchema = z.object({
  crate: z.object({
    keywords: strings,
    categories: strings,
    repository: z.string().nullish(),
  }),
});

const pubSchema = z.object({
  latest: z.object({
    pubspec: z.object({
      topics: strings,
      repository: z.string().nullish(),
      homepage: z.string().nullish(),
    }),
  }),
});

const packagistVersion = z.object({
  keywords: strings,
  source: z.object({ url: z.string().nullish() }).nullish(),
});
const packagistSchema = z.object({ packages: z.record(z.string(), z.array(packagistVersion)) });

const clients: Partial<Record<Ecosystem, RegistryClient>> = {
  npm: {
    registry: 'npm',
    // The `latest` document carries the same keywords and repository as the full packument at a fraction of the size.
    url: (name) => `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`,
    parse(body) {
      const data = npmSchema.parse(body);
      const repository = typeof data.repository === 'string' ? data.repository : data.repository?.url;
      return {
        keywords: splitKeywords(data.keywords),
        classifiers: [],
        categories: [],
        repoFullName: githubRepoFromUrl(repository),
      };
    },
  },
  pypi: {
    registry: 'pypi',
    url: (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
    parse(body) {
      const { info } = pypiSchema.parse(body);
      const urls = [...Object.values(info.project_urls ?? {}), info.home_page];
      const repoFullName = urls.map(githubRepoFromUrl).find((repo) => repo !== null) ?? null;
      return {
        keywords: splitKeywords(info.keywords),
        classifiers: info.classifiers ?? [],
        categories: [],
        repoFullName,
      };
    },
  },
  crates: {
    registry: 'crates',
    url: (name) => `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`,
    parse(body) {
      const { crate } = cratesSchema.parse(body);
      return {
        keywords: crate.keywords ?? [],
        classifiers: [],
        categories: crate.categories ?? [],
        repoFullName: githubRepoFromUrl(crate.repository),
      };
    },
  },
  pub: {
    registry: 'pub',
    url: (name) => `https://pub.dev/api/packages/${encodeURIComponent(name)}`,
    parse(body) {
      const { pubspec } = pubSchema.parse(body).latest;
      return {
        keywords: pubspec.topics ?? [],
        classifiers: [],
        categories: [],
        repoFullName: githubRepoFromUrl(pubspec.repository) ?? githubRepoFromUrl(pubspec.homepage),
      };
    },
  },
  packagist: {
    registry: 'packagist',
    url: (name) => `https://repo.packagist.org/p2/${name.split('/').map(encodeURIComponent).join('/')}.json`,
    parse(body, name) {
      // Versions are listed newest first; the first one is the current release.
      const latest = packagistSchema.parse(body).packages[name]?.[0];
      return {
        keywords: latest?.keywords ?? [],
        classifiers: [],
        categories: [],
        repoFullName: githubRepoFromUrl(latest?.source?.url),
      };
    },
  },
};

/** The registry client of an ecosystem, or `null` for ecosystems without a registry call (Go, Maven, RubyGems). */
export function registryClientFor(ecosystem: Ecosystem): RegistryClient | null {
  return clients[ecosystem] ?? null;
}
