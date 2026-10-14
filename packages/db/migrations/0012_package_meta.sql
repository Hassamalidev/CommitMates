CREATE TABLE "package_meta" (
	"ecosystem" text NOT NULL,
	"name" text NOT NULL,
	"keywords" text[] NOT NULL,
	"classifiers" text[] NOT NULL,
	"repo_full_name" text,
	"gh_topics" text[] NOT NULL,
	"derived_tags" text[] NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_meta_ecosystem_name_pk" PRIMARY KEY("ecosystem","name")
);
--> statement-breakpoint
ALTER TABLE "package_meta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registry_pacing" (
	"registry" text PRIMARY KEY NOT NULL,
	"last_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry_pacing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "package_meta_expires_idx" ON "package_meta" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "package_meta_tags_idx" ON "package_meta" USING gin ("derived_tags");