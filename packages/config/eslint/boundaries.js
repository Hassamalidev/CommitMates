/**
 * Package boundary table (CLAUDE.md §4.3), the single source for the lint rules
 * that keep internal imports one-directional.
 */

export const SCOPE = '@commitmates';

/** Internal package → internal packages it may import. */
export const PACKAGE_BOUNDARIES = {
  algorithms: [],
  config: [],
  env: [],
  email: ['env'],
  db: ['env'],
  github: ['db', 'env'],
  jobs: ['db', 'env'],
  sources: ['db', 'env', 'github'],
  core: ['algorithms', 'db', 'env', 'github', 'sources', 'jobs', 'email'],
  ui: [],
};

/** App → internal packages it may import. `null` means every package. */
export const APP_BOUNDARIES = {
  web: null,
  worker: ['jobs', 'core', 'env'],
};

/** AI and LLM SDKs are never allowed (CLAUDE.md §2.1). */
export const AI_SDK_PATTERNS = [
  'openai',
  'openai/*',
  '@anthropic-ai/*',
  '@google/generative-ai',
  '@google/genai',
  '@ai-sdk/*',
  'ai',
  'langchain',
  '@langchain/*',
  'llamaindex',
  '@huggingface/*',
  '@xenova/transformers',
  'replicate',
  'cohere-ai',
  'ollama',
  '@mistralai/*',
  'groq-sdk',
];

export const FIXTURE_PATTERN = '**/__fixtures__/**';

export const TEST_FILE_GLOBS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/__tests__/**',
  '**/test/**',
  'e2e/**',
];

const ALL_PACKAGES = Object.keys(PACKAGE_BOUNDARIES);

/** Internal packages a workspace member must not import. */
export function forbiddenFor(name, allowed) {
  if (allowed === null) return [];
  return ALL_PACKAGES.filter((pkg) => pkg !== name && !allowed.includes(pkg));
}

function restrictedImportsRule(forbidden, { allowFixtures }) {
  const patterns = [
    {
      group: AI_SDK_PATTERNS,
      message: 'AI and LLM SDKs are not allowed (CLAUDE.md §2.1).',
    },
  ];
  if (!allowFixtures) {
    patterns.push({
      group: [FIXTURE_PATTERN],
      message: 'Fixtures may only be imported by test files (CLAUDE.md §2.4).',
    });
  }
  if (forbidden.length > 0) {
    patterns.push({
      group: forbidden.flatMap((pkg) => [`${SCOPE}/${pkg}`, `${SCOPE}/${pkg}/*`]),
      message: 'This import crosses a package boundary (CLAUDE.md §4.3).',
    });
  }
  return ['error', { patterns }];
}

/**
 * Flat-config blocks for `no-restricted-imports`. Later blocks replace earlier
 * options, so every block carries the complete pattern list for its files.
 */
export function restrictedImportBlocks() {
  const members = [
    ...Object.entries(PACKAGE_BOUNDARIES).map(([name, allowed]) => ({
      dir: `packages/${name}`,
      forbidden: forbiddenFor(name, allowed),
    })),
    ...Object.entries(APP_BOUNDARIES).map(([name, allowed]) => ({
      dir: `apps/${name}`,
      forbidden: forbiddenFor(name, allowed),
    })),
  ];

  const blocks = [
    {
      name: 'commitmates/restricted-imports/default',
      rules: { 'no-restricted-imports': restrictedImportsRule([], { allowFixtures: false }) },
    },
    {
      name: 'commitmates/restricted-imports/tests',
      files: TEST_FILE_GLOBS,
      rules: { 'no-restricted-imports': restrictedImportsRule([], { allowFixtures: true }) },
    },
  ];

  for (const { dir, forbidden } of members) {
    blocks.push({
      name: `commitmates/restricted-imports/${dir}`,
      files: [`${dir}/**`],
      rules: { 'no-restricted-imports': restrictedImportsRule(forbidden, { allowFixtures: false }) },
    });
    blocks.push({
      name: `commitmates/restricted-imports/${dir}/tests`,
      files: TEST_FILE_GLOBS.filter((glob) => !glob.startsWith('e2e')).map((glob) => `${dir}/${glob}`),
      rules: { 'no-restricted-imports': restrictedImportsRule(forbidden, { allowFixtures: true }) },
    });
  }
  return blocks;
}

/** Zones for `import-x/no-restricted-paths`: catches relative imports that reach across packages. */
export function restrictedPathZones() {
  const zones = [];
  for (const [name, allowed] of Object.entries(PACKAGE_BOUNDARIES)) {
    for (const pkg of forbiddenFor(name, allowed)) {
      zones.push({
        target: `./packages/${name}`,
        from: `./packages/${pkg}`,
        message: 'This import crosses a package boundary (CLAUDE.md §4.3).',
      });
    }
    zones.push({
      target: `./packages/${name}`,
      from: './apps',
      message: 'Packages must not import from apps (CLAUDE.md §4.3).',
    });
  }
  for (const [name, allowed] of Object.entries(APP_BOUNDARIES)) {
    for (const pkg of forbiddenFor(name, allowed)) {
      zones.push({
        target: `./apps/${name}`,
        from: `./packages/${pkg}`,
        message: 'This import crosses a package boundary (CLAUDE.md §4.3).',
      });
    }
  }
  return zones;
}
