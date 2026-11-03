# Rotate the token encryption key

When to use: the key that encrypts members' GitHub tokens (`TOKEN_ENCRYPTION_KEY`) may have leaked, someone who had it left, or on a regular schedule.
Prerequisites: access to the environment variables of the deployment (Vercel project settings, or `.env.local` locally) and to `/admin/jobs` as an admin. Stored tokens are AES-256-GCM, prefixed with their key version (`v1.…`); CLAUDE.md §5.10.

## Steps

1. **Make the new key.** `openssl rand -base64 32`. Keep it in your password manager; never paste it into a ticket or chat.
2. **Keep the old key for reading.** Set `TOKEN_ENCRYPTION_KEY_PREV` to the current value of `TOKEN_ENCRYPTION_KEY`.
3. **Install the new key.** Set `TOKEN_ENCRYPTION_KEY` to the new key and increase `TOKEN_ENCRYPTION_KEY_VERSION` by one (for example 1 → 2).
4. **Deploy** (or restart `pnpm dev` and the worker locally). From now on new sign-ins store tokens under the new version, and tokens under the old version are still read with the previous key.
5. **Queue the re-encryption.** With the same environment, run `pnpm tokens:reencrypt` from the repository root. It queues one `reencrypt_tokens` job for the new version (running it again for the same version does nothing).
6. **Let it run.** The next tick picks it up (every minute in production, every few seconds with the local worker). It re-encrypts every token not on the new version, a page at a time, and continues in follow-up jobs if time runs out. Watch `/admin/jobs`: the job and its continuations end as done; the log line `tokens re-encrypted` reports how many were re-encrypted and how many were dropped.
7. **Check nothing is left on the old version.** In the SQL editor of the database: `select count(*) from github_identities where token_enc is not null and token_key_version <> <new version>;` must return 0.
8. **Remove the old key.** Delete `TOKEN_ENCRYPTION_KEY_PREV` and deploy again.

## Verify it worked

- Step 7 returns 0, and the job shows as done on `/admin/jobs`.
- Sign in as a member and run a Dev Card on your own login: it uses your stored token, so it fails with an authentication error if the token cannot be read.

## Roll back

- **Before step 8:** set `TOKEN_ENCRYPTION_KEY` back to the old key, `TOKEN_ENCRYPTION_KEY_PREV` to the new one, and the version back. Re-encrypted tokens are still readable through the previous key; queue `pnpm tokens:reencrypt` again to bring them back to the old version.
- **If the job fails with `crypto.unknown_key_version`:** `TOKEN_ENCRYPTION_KEY_PREV` is missing or wrong in the environment the job runs in. Nothing was changed; fix the variable and run step 5 again.
- **Tokens reported as dropped** could be read with neither key (for example a corrupted value). Those members are asked to sign in with GitHub again; nothing else is lost.
- **After step 8** tokens still on the old version can no longer be read. If step 7 was skipped, restore `TOKEN_ENCRYPTION_KEY_PREV` and run step 5 again before removing it.
