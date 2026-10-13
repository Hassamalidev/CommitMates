import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@commitmates/core', () => {
  it('exports the name declared in package.json', () => {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({ name: PACKAGE_NAME });
  });
});
