import { createHash } from 'node:crypto';

import { schema } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceModule, SyncCounts } from '../contract';

import { normalizeGitleaks, type GitleaksItem, type SecretRuleItem } from './normalize';

const { secretRules, secretGlobalAllowlist } = schema;

/** Where gitleaks publishes its default rules (CLAUDE.md §6.7). */
const GITLEAKS_REPO = { owner: 'gitleaks', repo: 'gitleaks' } as const;
const CONFIG_PATH = 'config/gitleaks.toml';
/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';
const GLOBAL_ID = 'global';

/** gitleaks' default secret rules and global allowlist, compiled with RE2 at sync time to count what is usable. */
export const gitleaksSource: SourceModule<string, GitleaksItem> = {
  name: 'gitleaks',

  async fetchRaw(ctx) {
    const raw = await githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now }).get(
      // {+path}: reserved expansion keeps the slash of the nested path unencoded.
      'GET /repos/{owner}/{repo}/contents/{+path}',
      { ...GITLEAKS_REPO, path: CONFIG_PATH },
      z.string().min(1),
      { accept: RAW_MEDIA_TYPE, cache: 'reference', what: `${GITLEAKS_REPO.owner}/${GITLEAKS_REPO.repo}/${CONFIG_PATH}` },
    );
    return { raw, version: createHash('sha256').update(raw).digest('hex') };
  },

  normalize: normalizeGitleaks,

  countUnusable: (items) => items.filter((item) => item.kind === 'rule' && !item.compiledOk).length,

  async sync(items, ctx) {
    const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
    const syncedAt = ctx.now();
    const rules = items.filter((item): item is SecretRuleItem => item.kind === 'rule');
    const existing = new Map((await ctx.db.select({ id: secretRules.id, checksum: secretRules.checksum }).from(secretRules)).map((row) => [row.id, row.checksum]));

    const values = (rule: SecretRuleItem) => ({
      description: rule.description,
      regex: rule.regex,
      keywords: rule.keywords,
      entropy: rule.entropy,
      secretGroup: rule.secretGroup,
      pathRegex: rule.pathRegex,
      allowlists: rule.allowlists,
      compiledOk: rule.compiledOk,
      checksum: rule.checksum,
      syncedAt,
    });
    const added: (typeof secretRules.$inferInsert)[] = [];
    for (const rule of rules) {
      const checksum = existing.get(rule.id);
      existing.delete(rule.id);
      if (checksum === undefined) {
        added.push({ id: rule.id, ...values(rule) });
        counts.inserted += 1;
      } else if (checksum !== rule.checksum) {
        await ctx.db.update(secretRules).set(values(rule)).where(eq(secretRules.id, rule.id));
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    }
    if (added.length > 0) await ctx.db.insert(secretRules).values(added);
    const removed = [...existing.keys()];
    if (removed.length > 0) {
      await ctx.db.delete(secretRules).where(inArray(secretRules.id, removed));
      counts.deleted = removed.length;
    }

    const global = items.find((item) => item.kind === 'global');
    if (global) {
      await ctx.db
        .insert(secretGlobalAllowlist)
        .values({ id: GLOBAL_ID, allowlist: global.allowlist, syncedAt })
        .onConflictDoUpdate({ target: secretGlobalAllowlist.id, set: { allowlist: global.allowlist, syncedAt } });
    }
    return counts;
  },
};
