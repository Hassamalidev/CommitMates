import { closeDb, queueTokenReencryption, registerAllHandlers } from '@commitmates/core';

// Queues `reencrypt_tokens` for the current key version (`pnpm tokens:reencrypt`, docs/runbooks/rotate-token-key.md).
registerAllHandlers();
const { jobId, keyVersion } = await queueTokenReencryption();
console.info(`Queued reencrypt_tokens for key version ${keyVersion} (job ${jobId}). The next tick runs it; watch /admin/jobs.`);
await closeDb();
