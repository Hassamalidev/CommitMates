import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  // Only `db:studio` connects; `db:generate` diffs the schema files offline.
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
