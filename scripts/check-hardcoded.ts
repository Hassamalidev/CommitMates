import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { findHardcoded, formatHardcodedFinding, isCheckedFile } from './lib/hardcoded';

/** Packages whose behavior must come from settings, not literals (CLAUDE.md §10.12). */
const CHECKED_ROOTS = ['packages/core/src', 'packages/algorithms/src'];

const repoRoot = path.resolve(import.meta.dirname, '..');

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const findings = CHECKED_ROOTS.flatMap((root) =>
  listFiles(path.join(repoRoot, root))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .filter(isCheckedFile)
    .flatMap((file) => findHardcoded(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
);

if (findings.length > 0) {
  for (const finding of findings) console.error(formatHardcodedFinding(finding));
  console.error(
    `\n${findings.length} unexplained literal(s). Move the value to a settings key, name it as a documented ` +
      'constant, or mark it `// allowed-literal: <reason>` (CLAUDE.md §2.3).',
  );
  process.exit(1);
}
console.info('check:hardcoded passed');
