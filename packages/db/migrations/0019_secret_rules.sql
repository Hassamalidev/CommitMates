CREATE TABLE "secret_global_allowlist" (
	"id" text PRIMARY KEY NOT NULL,
	"allowlist" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_global_allowlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "secret_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"regex" text,
	"keywords" text[] NOT NULL,
	"entropy" real,
	"secret_group" smallint DEFAULT 0 NOT NULL,
	"path_regex" text,
	"allowlists" jsonb NOT NULL,
	"compiled_ok" boolean NOT NULL,
	"checksum" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_rules" ENABLE ROW LEVEL SECURITY;