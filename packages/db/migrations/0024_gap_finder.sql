CREATE TABLE "repo_paths" (
	"repo_github_id" bigint NOT NULL,
	"path_feature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_paths_repo_github_id_path_feature_pk" PRIMARY KEY("repo_github_id","path_feature")
);
--> statement-breakpoint
ALTER TABLE "repo_paths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gap_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"peer_repo_ids" bigint[] NOT NULL,
	"facets" jsonb NOT NULL,
	"gaps" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gap_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_paths" ADD CONSTRAINT "repo_paths_repo_github_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_github_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_reports_repo_idx" ON "gap_reports" USING btree ("repo_github_id");--> statement-breakpoint
CREATE INDEX "gap_reports_computed_idx" ON "gap_reports" USING btree ("computed_at");