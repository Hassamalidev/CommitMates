-- Recreates the trigram index with the expression in parentheses, the form drizzle-kit's
-- snapshot records. 0015 was corrected by hand to the same definition, so this changes nothing in effect.
DROP INDEX "gh_repos_full_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "gh_repos_full_name_trgm_idx" ON "gh_repos" USING gin (("full_name"::text) gin_trgm_ops);