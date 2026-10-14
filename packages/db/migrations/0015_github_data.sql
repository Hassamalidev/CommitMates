CREATE TYPE "public"."gh_account_type" AS ENUM('User', 'Organization', 'Bot');--> statement-breakpoint
CREATE TABLE "analysis_cache" (
	"kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"params_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"is_member_subject" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_cache_kind_subject_key_params_hash_pk" PRIMARY KEY("kind","subject_key","params_hash")
);
--> statement-breakpoint
ALTER TABLE "analysis_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gh_repos" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"owner_github_id" bigint NOT NULL,
	"full_name" "citext" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"homepage" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_language" text,
	"languages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"forks" integer DEFAULT 0 NOT NULL,
	"open_issues" integer DEFAULT 0 NOT NULL,
	"license_spdx" text,
	"is_fork" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"has_readme" boolean,
	"readme_chars" integer,
	"readme_headings" text[] DEFAULT '{}'::text[] NOT NULL,
	"unfinished_score" real,
	"default_branch" text,
	"size_kb" integer,
	"commit_count_est" integer,
	"release_count" integer,
	"gh_created_at" timestamp with time zone,
	"pushed_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || immutable_array_to_string(topics, ' ') || ' ' || immutable_array_to_string(readme_headings, ' '))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gh_repos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gh_users" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"login" "citext" NOT NULL,
	"type" "gh_account_type" DEFAULT 'User' NOT NULL,
	"name" text,
	"location_raw" text,
	"geocode_key" text,
	"company" text,
	"blog" text,
	"bio" text,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"public_repos" integer DEFAULT 0 NOT NULL,
	"gh_created_at" timestamp with time zone,
	"is_member" boolean DEFAULT false NOT NULL,
	"in_country_index" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gh_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo_dependencies" (
	"repo_github_id" bigint NOT NULL,
	"ecosystem" text NOT NULL,
	"package_name" text NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_dependencies_repo_github_id_ecosystem_package_name_pk" PRIMARY KEY("repo_github_id","ecosystem","package_name")
);
--> statement-breakpoint
ALTER TABLE "repo_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo_manifests" (
	"repo_github_id" bigint NOT NULL,
	"path" text NOT NULL,
	"ecosystem" text NOT NULL,
	"blob_sha" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_manifests_repo_github_id_path_pk" PRIMARY KEY("repo_github_id","path")
);
--> statement-breakpoint
ALTER TABLE "repo_manifests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_dependencies" ADD CONSTRAINT "repo_dependencies_repo_github_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_github_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_manifests" ADD CONSTRAINT "repo_manifests_repo_github_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_github_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_cache_expires_idx" ON "analysis_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gh_repos_full_name_key" ON "gh_repos" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "gh_repos_owner_idx" ON "gh_repos" USING btree ("owner_github_id");--> statement-breakpoint
CREATE INDEX "gh_repos_pushed_idx" ON "gh_repos" USING btree ("pushed_at");--> statement-breakpoint
CREATE INDEX "gh_repos_expires_idx" ON "gh_repos" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "gh_repos_search_idx" ON "gh_repos" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "gh_repos_full_name_trgm_idx" ON "gh_repos" USING gin (("full_name"::text) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "gh_users_login_key" ON "gh_users" USING btree ("login");--> statement-breakpoint
CREATE INDEX "gh_users_expires_idx" ON "gh_users" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "gh_users_geocode_idx" ON "gh_users" USING btree ("geocode_key");--> statement-breakpoint
CREATE INDEX "repo_dependencies_package_idx" ON "repo_dependencies" USING btree ("ecosystem","package_name");