CREATE TABLE "taxonomy_expansions" (
	"term" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"items" jsonb NOT NULL,
	"sample_size" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "taxonomy_expansions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "topic_global_counts" (
	"slug" text PRIMARY KEY NOT NULL,
	"total_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_global_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "taxonomy_expansions_expires_idx" ON "taxonomy_expansions" USING btree ("expires_at");