CREATE TYPE "public"."profile_role" AS ENUM('student', 'alumni', 'supervisor_pending', 'supervisor');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('university', 'country', 'public', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."role_kind" AS ENUM('admin', 'uni_moderator');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'hidden_pending_review');--> statement-breakpoint
CREATE TYPE "public"."verified_via" AS ENUM('email', 'vouch', 'admin');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."geocode_status" AS ENUM('pending', 'resolved', 'unresolvable');--> statement-breakpoint
CREATE TABLE "github_identities" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"login" "citext" NOT NULL,
	"name" text,
	"avatar_url" text,
	"token_enc" text,
	"token_key_version" smallint,
	"token_invalid" boolean DEFAULT false NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"private_contrib_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_identities_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "github_identities_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "github_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid,
	"role" "profile_role" DEFAULT 'student' NOT NULL,
	"grad_year" smallint,
	"department_id" uuid,
	"timezone" text NOT NULL,
	"visibility" "profile_visibility" DEFAULT 'university' NOT NULL,
	"ghost_mode" boolean DEFAULT false NOT NULL,
	"learning_goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text,
	"onboarded_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_via" "verified_via",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_kind" NOT NULL,
	"university_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"cron_expr" text NOT NULL,
	"job_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"idempotency_key" text,
	"progress" jsonb,
	"result_ref" jsonb,
	"last_error" text,
	"user_message" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_type" text NOT NULL,
	"default_value" jsonb NOT NULL,
	"computed_value" jsonb,
	"override_value" jsonb,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"min_sample" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone,
	"unit" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_value_type_check" CHECK ("settings"."value_type" in ('number','integer','boolean','string','string[]','number[]','json'))
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_history_field_check" CHECK ("settings_history"."field" in ('computed','override','default')),
	CONSTRAINT "settings_history_source_check" CHECK ("settings_history"."source" in ('recompute','admin','migration'))
);
--> statement-breakpoint
ALTER TABLE "settings_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_cache" (
	"token_identity" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"status" smallint NOT NULL,
	"body" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_cache_token_identity_method_url_pk" PRIMARY KEY("token_identity","method","url")
);
--> statement-breakpoint
ALTER TABLE "api_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "github_budgets" (
	"token_identity" text NOT NULL,
	"resource" text NOT NULL,
	"limit" integer,
	"remaining" integer,
	"reset_at" timestamp with time zone,
	"last_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_budgets_token_identity_resource_pk" PRIMARY KEY("token_identity","resource")
);
--> statement-breakpoint
ALTER TABLE "github_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"page" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"query_norm" text PRIMARY KEY NOT NULL,
	"status" "geocode_status" DEFAULT 'pending' NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"city" text,
	"country_code" text,
	"timezone" text,
	"confidence" real,
	"provider" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geocode_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "geocoder_lock" (
	"id" smallint PRIMARY KEY NOT NULL,
	"last_call_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocoder_lock_single_row" CHECK ("geocoder_lock"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "geocoder_lock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision NOT NULL,
	"subject_hash" text NOT NULL,
	"salt_period" integer NOT NULL,
	"recorded_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_samples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"kinds_muted" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salts" (
	"period" integer PRIMARY KEY NOT NULL,
	"salt" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"source" text PRIMARY KEY NOT NULL,
	"version" text,
	"checksum" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tool_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"ip_hash_day" text NOT NULL,
	"user_id" uuid,
	"converted_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_identities" ADD CONSTRAINT "github_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_id_jobs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_key_settings_key_fk" FOREIGN KEY ("key") REFERENCES "public"."settings"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_sessions" ADD CONSTRAINT "tool_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_sessions" ADD CONSTRAINT "tool_sessions_converted_user_id_users_id_fk" FOREIGN KEY ("converted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_university_idx" ON "profiles" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "profiles_department_idx" ON "profiles" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_user_role_university_key" ON "roles" USING btree ("user_id","role",coalesce("university_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "roles_university_idx" ON "roles" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("priority" DESC NULLS LAST,"run_at") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("locked_at") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_parent_idx" ON "jobs" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "settings_history_key_idx" ON "settings_history" USING btree ("key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "geocode_cache_pending_idx" ON "geocode_cache" USING btree ("created_at") WHERE "geocode_cache"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "metric_samples_dedupe_key" ON "metric_samples" USING btree ("metric_key","subject_hash","salt_period");--> statement-breakpoint
CREATE INDEX "metric_samples_metric_day_idx" ON "metric_samples" USING btree ("metric_key","recorded_on");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "tool_sessions_tool_created_idx" ON "tool_sessions" USING btree ("tool","created_at");--> statement-breakpoint
CREATE INDEX "tool_sessions_ip_hash_idx" ON "tool_sessions" USING btree ("ip_hash_day");--> statement-breakpoint
CREATE INDEX "tool_sessions_user_idx" ON "tool_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tool_sessions_converted_idx" ON "tool_sessions" USING btree ("converted_user_id");