CREATE TABLE "topics" (
	"slug" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"aliases" text[] NOT NULL,
	"related" text[] NOT NULL,
	"blob_sha" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "topics_aliases_idx" ON "topics" USING gin ("aliases");