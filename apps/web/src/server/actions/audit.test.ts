import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The input-validation audit of every Server Action (CLAUDE.md §5.10, §10.3, P7-T01c): each exported
 * action checks who is calling (a guard) before doing anything, and each one that writes takes a
 * rate-limit token. Inputs are parsed with zod in the core services the actions call. Exceptions are
 * listed with their reason, so a new action without a guard or a rate limit fails here.
 */

const DIRECTORY = import.meta.dirname;
const GUARD = /\brequire(User|Verified|Role)\(/;
const RATE = /\bguard\w*Rate\(/;

/** Actions open to anyone, with why that is safe. */
const PUBLIC: Record<string, string> = {
  'optout.ts:optOutAction': 'The country-index opt-out only removes data and is rate-limited per hashed address (§8 F18).',
};

/** Guarded actions without a rate limit, with why none is needed. */
const NO_RATE: Record<string, string> = {
  'admin.ts:*': 'Admin-only (requireRole) and audited; admins are trusted and few.',
  'roles.ts:*': 'Admin-only role grants, audited.',
  'universities.ts:*': 'University reviews by admins and moderators, audited.',
  'moderation.ts:*': 'Moderator decisions, scoped and audited.',
  'reviews.ts:resolveDisputeAction': 'Dispute decisions by admins and moderators, audited.',
  'reviews.ts:adjustCreditsAction': 'Admin-only credit adjustments, audited.',
  'fyp-board.ts:decideSupervisorAction': 'Supervisor approvals by admins and moderators, audited.',
  'recruiter.ts:*': 'Reads the signed-in member’s own secret findings; nothing is written or fetched from GitHub.',
  'events.ts:*': 'Every event action goes through eventAction or joinEventAction, which rate-limit; see the factory check.',
  'chat.ts:markReadAction': 'Moves the member’s own read marker in a thread they belong to; called as messages arrive, writes nothing anyone else sees.',
  'gap.ts:gapHelpersAction': 'Read-only: lists classmates for the member’s own Gap Finder result from the database.',
  'oss.ts:ossCampusAction': 'Read-only: lists classmates who contributed to the projects on the member’s own result page.',
  'notifications.ts:notificationBadgeAction': 'Read-only: the member’s own unread count for the header badge.',
};

type ExportedAction = { file: string; name: string; text: string };

/** The exported actions of a file, each with its own source and that of the local functions it uses. */
function actionsOf(file: string): ExportedAction[] {
  const source = ts.createSourceFile(file, readFileSync(path.join(DIRECTORY, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const locals = new Map<string, string>();
  const exported: string[] = [];
  for (const statement of source.statements) {
    const isExported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      locals.set(statement.name.text, statement.getText(source));
      if (isExported) exported.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        locals.set(declaration.name.text, statement.getText(source));
        if (isExported) exported.push(declaration.name.text);
      }
    }
  }
  const expand = (text: string, seen: Set<string>): string =>
    [...locals.entries()]
      .filter(([name]) => !seen.has(name) && new RegExp(`\\b${name}\\(`).test(text))
      .reduce((all, [name, body]) => all + '\n' + expand(body, new Set([...seen, name])), text);
  return exported.map((name) => ({ file, name, text: expand(locals.get(name) ?? '', new Set([name])) }));
}

const files = readdirSync(DIRECTORY).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
const actions = files.flatMap(actionsOf).filter((action) => /async|Action/.test(action.text));
const listed = (table: Record<string, string>, action: ExportedAction) => table[`${action.file}:${action.name}`] ?? table[`${action.file}:*`];

describe('Server Action audit', () => {
  it('finds the actions of every file', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(actions.length).toBeGreaterThan(80);
  });

  it('checks the caller first in every action, apart from the listed public ones', () => {
    const unguarded = actions.filter((action) => !GUARD.test(action.text) && listed(PUBLIC, action) === undefined).map((action) => `${action.file}:${action.name}`);
    expect(unguarded).toEqual([]);
  });

  it('rate-limits every action that writes, apart from the listed ones', () => {
    const unlimited = actions
      .filter((action) => !RATE.test(action.text) && listed(NO_RATE, action) === undefined && listed(PUBLIC, action) === undefined)
      .map((action) => `${action.file}:${action.name}`);
    expect(unlimited).toEqual([]);
  });

  it('keeps the event factory rate-limited, since its actions are listed by file', () => {
    const events = actionsOf('events.ts');
    expect(events.length).toBeGreaterThan(5);
    for (const action of events) expect(RATE.test(action.text), action.name).toBe(true);
  });

  it('keeps every exception justified and current', () => {
    for (const reason of [...Object.values(PUBLIC), ...Object.values(NO_RATE)]) expect(reason.length).toBeGreaterThan(20);
    for (const key of [...Object.keys(PUBLIC), ...Object.keys(NO_RATE)]) {
      const [file, name] = key.split(':');
      expect(files, key).toContain(file);
      if (name !== '*') expect(actionsOf(file ?? '').map((action) => action.name), key).toContain(name);
    }
  });
});
