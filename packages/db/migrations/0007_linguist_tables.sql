CREATE TYPE "public"."path_pattern_kind" AS ENUM('vendored', 'documentation');--> statement-breakpoint
CREATE TABLE "languages" (
	"name" text PRIMARY KEY NOT NULL,
	"color" text,
	"extensions" text[] NOT NULL,
	"aliases" text[] NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "languages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "path_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "path_pattern_kind" NOT NULL,
	"pattern" text NOT NULL,
	"compiled_ok" boolean NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "path_patterns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "path_patterns_kind_pattern_key" ON "path_patterns" USING btree ("kind","pattern");