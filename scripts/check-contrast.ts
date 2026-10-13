import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { CONTRAST_RULES, checkContrast, formatContrastFailure, parseTokens } from './lib/contrast';

const repoRoot = path.resolve(import.meta.dirname, '..');
const TOKEN_FILES = ['packages/ui/src/tokens.css'];

const present = TOKEN_FILES.filter((file) => existsSync(path.join(repoRoot, file)));
if (present.length === 0) {
  console.info('check:contrast skipped: no token files exist yet');
  process.exit(0);
}

let failed = 0;
let checked = 0;
for (const file of present) {
  const themes = parseTokens(readFileSync(path.join(repoRoot, file), 'utf8'));
  const themeNames = Object.keys(themes);
  if (themeNames.length === 0) {
    console.error(`${file}: no :root[data-theme="…"] blocks found`);
    failed += 1;
    continue;
  }
  checked += themeNames.length * CONTRAST_RULES.length;
  for (const failure of checkContrast(themes, CONTRAST_RULES)) {
    console.error(`${file}  ${formatContrastFailure(failure)}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} contrast problem(s). Every pair must meet WCAG AA (CLAUDE.md §9.2).`);
  process.exit(1);
}
console.info(`check:contrast passed (${checked} pairs)`);
