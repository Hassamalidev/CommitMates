import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ALLOWED_LICENSES, dependencyCredits, findLicenseViolations, formatLicenseViolation, parsePnpmLicenses } from './lib/licenses';

const repoRoot = path.resolve(import.meta.dirname, '..');
/** The dependency list /attribution renders (CLAUDE.md §6.11); `pnpm licenses:report` rewrites it. */
const creditsPath = path.join(repoRoot, 'apps/web/src/generated/dependency-licenses.json');
const write = process.argv.includes('--write');

/** Enough for the JSON report of a large dependency tree. */
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

const exceptionsSchema = z.array(
  z.object({ name: z.string().min(1), license: z.string().min(1), reason: z.string().min(1) }),
);

const exceptions = exceptionsSchema.parse(
  JSON.parse(readFileSync(path.join(repoRoot, 'scripts/license-exceptions.json'), 'utf8')),
);

// Shipped code is the production dependency closure of the apps and packages (CLAUDE.md §2.2).
// The tooling package is excluded: its dependencies are linters and test libraries.
const report = execSync('pnpm -r --filter "!@commitmates/config" licenses list --prod --json', {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: MAX_REPORT_BYTES,
});
const parsed: unknown = JSON.parse(report);
const packages = parsePnpmLicenses(parsed);
if (packages.length === 0) {
  console.error('check:licenses found no production dependencies; run `pnpm install` first.');
  process.exit(1);
}

const violations = findLicenseViolations(packages, ALLOWED_LICENSES, exceptions);
if (violations.length > 0) {
  for (const violation of violations) console.error(formatLicenseViolation(violation));
  console.error(
    `\n${violations.length} dependency license(s) outside the allow-list: ${ALLOWED_LICENSES.join(', ')}.\n` +
      'Replace the dependency, or record a reviewed exception in an ADR and scripts/license-exceptions.json.',
  );
  process.exit(1);
}

const credits = `${JSON.stringify(dependencyCredits(parsed), null, 2)}\n`;
if (write) {
  mkdirSync(path.dirname(creditsPath), { recursive: true });
  writeFileSync(creditsPath, credits);
  console.info(`Wrote ${path.relative(repoRoot, creditsPath)}`);
} else if (!existsSync(creditsPath) || readFileSync(creditsPath, 'utf8').replace(/\r\n/g, '\n') !== credits) {
  console.error(
    `${path.relative(repoRoot, creditsPath)} does not match the production dependencies.\n` +
      'Run `pnpm licenses:report` and commit the result, so /attribution credits what ships.',
  );
  process.exit(1);
}
console.info(`check:licenses passed (${packages.length} production packages)`);
