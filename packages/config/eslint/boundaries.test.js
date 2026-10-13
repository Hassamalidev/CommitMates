import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { PACKAGE_BOUNDARIES, forbiddenFor, restrictedImportBlocks } from './boundaries.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The files linted here exist only in memory, so the type-aware project service
// cannot load them. The boundary blocks are the same ones the real config spreads in.
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...restrictedImportBlocks(),
  ],
});

async function ruleIdsFor(code, relativePath) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relativePath) });
  return (result?.messages ?? []).map((message) => message.ruleId);
}

describe('package boundaries', () => {
  it('derives forbidden packages from the allow-list', () => {
    expect(forbiddenFor('db', PACKAGE_BOUNDARIES.db)).toContain('core');
    expect(forbiddenFor('db', PACKAGE_BOUNDARIES.db)).not.toContain('env');
    expect(forbiddenFor('algorithms', PACKAGE_BOUNDARIES.algorithms)).toHaveLength(
      Object.keys(PACKAGE_BOUNDARIES).length - 2,
    );
  });

  it('fails lint when db imports core', async () => {
    const ids = await ruleIdsFor(
      "import { anything } from '@commitmates/core';\nexport const x = anything;\n",
      'packages/db/src/illegal.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('fails lint when algorithms imports anything internal', async () => {
    const ids = await ruleIdsFor(
      "import { db } from '@commitmates/db/client';\nexport const x = db;\n",
      'packages/algorithms/src/illegal.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('fails lint when the worker imports ui', async () => {
    const ids = await ruleIdsFor(
      "import { Button } from '@commitmates/ui';\nexport const x = Button;\n",
      'apps/worker/src/illegal.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('allows core to import db', async () => {
    const ids = await ruleIdsFor(
      "import { db } from '@commitmates/db';\nexport const x = db;\n",
      'packages/core/src/legal.ts',
    );
    expect(ids).not.toContain('no-restricted-imports');
  });

  it('blocks AI SDKs everywhere', async () => {
    const ids = await ruleIdsFor(
      "import OpenAI from 'openai';\nexport const x = OpenAI;\n",
      'packages/core/src/illegal-ai.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('blocks fixture imports outside tests and allows them inside tests', async () => {
    const code = "import data from './__fixtures__/user.json';\nexport const x = data;\n";
    expect(await ruleIdsFor(code, 'packages/github/src/client.ts')).toContain('no-restricted-imports');
    expect(await ruleIdsFor(code, 'packages/github/src/client.test.ts')).not.toContain('no-restricted-imports');
  });
});
