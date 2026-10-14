CREATE TABLE "stopwords" (
	"language" text PRIMARY KEY NOT NULL,
	"words" text[] NOT NULL,
	"checksum" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stopwords" ENABLE ROW LEVEL SECURITY;