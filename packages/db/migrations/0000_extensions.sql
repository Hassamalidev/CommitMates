-- Extensions the schema depends on: case-insensitive text and trigram search (CLAUDE.md §7).
create extension if not exists citext;
--> statement-breakpoint
create extension if not exists pg_trgm;
