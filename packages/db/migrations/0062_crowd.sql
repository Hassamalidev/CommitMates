CREATE TYPE "public"."alumni_question_status" AS ENUM('open', 'answered', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."crawl_cursor_status" AS ENUM('pending', 'splitting', 'running', 'done');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('open', 'forming', 'finalized', 'closed');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('university', 'country', 'public');--> statement-breakpoint
CREATE TYPE "public"."fyp_idea_status" AS ENUM('open', 'team_forming', 'taken', 'archived');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_scope" AS ENUM('university', 'department', 'member');--> statement-breakpoint
CREATE TYPE "public"."question_route_status" AS ENUM('pending', 'answered', 'passed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."squad_status" AS ENUM('proposed', 'final');--> statement-breakpoint
CREATE TYPE "public"."squad_swap_status" AS ENUM('pending', 'done', 'rejected');--> statement-breakpoint
CREATE TABLE "alumni_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asker_user_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"body" text NOT NULL,
	"tags" text[] NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"status" "alumni_question_status" DEFAULT 'open' NOT NULL,
	"round" smallint DEFAULT 0 NOT NULL,
	"answered_by" uuid,
	"thread_id" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alumni_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crawl_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"created_from" date NOT NULL,
	"created_to" date NOT NULL,
	"page" integer DEFAULT 0 NOT NULL,
	"total_count" integer,
	"status" "crawl_cursor_status" DEFAULT 'pending' NOT NULL,
	"crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crawl_optouts" (
	"github_login" "citext" PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_optouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_participants" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"availability" jsonb,
	"locked_group_key" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_participants_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"visibility" "event_visibility" DEFAULT 'university' NOT NULL,
	"university_id" uuid,
	"country_code" char(2),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"team_size" smallint NOT NULL,
	"status" "event_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fyp_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"keyphrases" text[] NOT NULL,
	"supervisor_idea" boolean DEFAULT false NOT NULL,
	"status" "fyp_idea_status" DEFAULT 'open' NOT NULL,
	"thread_id" uuid,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || immutable_array_to_string(keyphrases, ' '))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fyp_ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fyp_interest" (
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fyp_interest_idea_id_user_id_pk" PRIMARY KEY("idea_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "fyp_interest" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fyp_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"owner_user_id" uuid,
	"year" smallint,
	"submitted_by" uuid,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fyp_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fyp_supervisors" (
	"user_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"approved_by" uuid,
	"areas" text[] NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fyp_supervisors_user_id_university_id_pk" PRIMARY KEY("user_id","university_id")
);
--> statement-breakpoint
ALTER TABLE "fyp_supervisors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leaderboard_optins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"opted_in_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_optins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "leaderboard_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"week_start" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"score" real NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_routes" (
	"question_id" uuid NOT NULL,
	"alumni_user_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"routed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"status" "question_route_status" DEFAULT 'pending' NOT NULL,
	CONSTRAINT "question_routes_question_id_alumni_user_id_pk" PRIMARY KEY("question_id","alumni_user_id")
);
--> statement-breakpoint
ALTER TABLE "question_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "squad_members" (
	"squad_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_label" text,
	CONSTRAINT "squad_members_squad_id_user_id_pk" PRIMARY KEY("squad_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "squad_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "squad_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_user" uuid NOT NULL,
	"to_squad_id" uuid NOT NULL,
	"status" "squad_swap_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_swap_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "squads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "squad_status" DEFAULT 'proposed' NOT NULL,
	"thread_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alumni_questions" ADD CONSTRAINT "alumni_questions_asker_user_id_users_id_fk" FOREIGN KEY ("asker_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_questions" ADD CONSTRAINT "alumni_questions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_questions" ADD CONSTRAINT "alumni_questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_questions" ADD CONSTRAINT "alumni_questions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_ideas" ADD CONSTRAINT "fyp_ideas_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_ideas" ADD CONSTRAINT "fyp_ideas_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_ideas" ADD CONSTRAINT "fyp_ideas_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_interest" ADD CONSTRAINT "fyp_interest_idea_id_fyp_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."fyp_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_interest" ADD CONSTRAINT "fyp_interest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_projects" ADD CONSTRAINT "fyp_projects_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_projects" ADD CONSTRAINT "fyp_projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_projects" ADD CONSTRAINT "fyp_projects_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_supervisors" ADD CONSTRAINT "fyp_supervisors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_supervisors" ADD CONSTRAINT "fyp_supervisors_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fyp_supervisors" ADD CONSTRAINT "fyp_supervisors_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_optins" ADD CONSTRAINT "leaderboard_optins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_routes" ADD CONSTRAINT "question_routes_question_id_alumni_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."alumni_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_routes" ADD CONSTRAINT "question_routes_alumni_user_id_users_id_fk" FOREIGN KEY ("alumni_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_swap_requests" ADD CONSTRAINT "squad_swap_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_swap_requests" ADD CONSTRAINT "squad_swap_requests_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_swap_requests" ADD CONSTRAINT "squad_swap_requests_to_squad_id_squads_id_fk" FOREIGN KEY ("to_squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squads" ADD CONSTRAINT "squads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squads" ADD CONSTRAINT "squads_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alumni_questions_asker_idx" ON "alumni_questions" USING btree ("asker_user_id");--> statement-breakpoint
CREATE INDEX "alumni_questions_university_status_idx" ON "alumni_questions" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "alumni_questions_answered_by_idx" ON "alumni_questions" USING btree ("answered_by");--> statement-breakpoint
CREATE INDEX "alumni_questions_thread_idx" ON "alumni_questions" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_cursors_slice_key" ON "crawl_cursors" USING btree ("seed","country_code","created_from","created_to");--> statement-breakpoint
CREATE INDEX "crawl_cursors_status_idx" ON "crawl_cursors" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "event_participants_user_idx" ON "event_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_creator_idx" ON "events" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX "events_university_idx" ON "events" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "fyp_ideas_university_status_idx" ON "fyp_ideas" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "fyp_ideas_author_idx" ON "fyp_ideas" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "fyp_ideas_thread_idx" ON "fyp_ideas" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "fyp_ideas_search_idx" ON "fyp_ideas" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "fyp_interest_user_idx" ON "fyp_interest" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fyp_projects_university_repo_key" ON "fyp_projects" USING btree ("university_id","repo_github_id");--> statement-breakpoint
CREATE INDEX "fyp_projects_owner_idx" ON "fyp_projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "fyp_projects_submitted_by_idx" ON "fyp_projects" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "fyp_supervisors_university_idx" ON "fyp_supervisors" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "fyp_supervisors_approved_by_idx" ON "fyp_supervisors" USING btree ("approved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshots_scope_week_key" ON "leaderboard_snapshots" USING btree ("scope","scope_id","week_start");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_board_idx" ON "leaderboard_snapshots" USING btree ("scope","group_id","week_start");--> statement-breakpoint
CREATE INDEX "question_routes_alumni_status_idx" ON "question_routes" USING btree ("alumni_user_id","status");--> statement-breakpoint
CREATE INDEX "squad_members_user_idx" ON "squad_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "squad_swap_requests_event_idx" ON "squad_swap_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "squad_swap_requests_from_idx" ON "squad_swap_requests" USING btree ("from_user");--> statement-breakpoint
CREATE INDEX "squad_swap_requests_to_squad_idx" ON "squad_swap_requests" USING btree ("to_squad_id");--> statement-breakpoint
CREATE INDEX "squads_event_version_idx" ON "squads" USING btree ("event_id","version");--> statement-breakpoint
CREATE INDEX "squads_thread_idx" ON "squads" USING btree ("thread_id");--> statement-breakpoint
create trigger crawl_cursors_set_updated_at before update on crawl_cursors
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger alumni_questions_set_updated_at before update on alumni_questions
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger events_set_updated_at before update on events
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger fyp_ideas_set_updated_at before update on fyp_ideas
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger fyp_projects_set_updated_at before update on fyp_projects
  for each row execute function set_updated_at();
