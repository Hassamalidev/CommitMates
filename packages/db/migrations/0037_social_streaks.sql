CREATE TYPE "public"."connection_source" AS ENUM('match', 'swap', 'squad', 'review', 'adoption', 'legacy', 'alumni');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('study', 'teammate', 'explore');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_request_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'impersonation', 'inappropriate', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_action" AS ENUM('liked', 'skipped', 'requested');--> statement-breakpoint
CREATE TYPE "public"."thread_kind" AS ENUM('direct', 'group', 'squad', 'swap', 'adoption');--> statement-breakpoint
CREATE TYPE "public"."companion_mood" AS ENUM('happy', 'neutral', 'sad');--> statement-breakpoint
CREATE TYPE "public"."pair_day_outcome" AS ENUM('counted', 'frozen', 'missed');--> statement-breakpoint
CREATE TYPE "public"."pair_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker" uuid NOT NULL,
	"blocked" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_blocked_pk" PRIMARY KEY("blocker","blocked")
);
--> statement-breakpoint
ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connections" (
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"source" "connection_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "connections_ordered" CHECK ("connections"."user_a" < "connections"."user_b")
);
--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "match_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_user_id" uuid NOT NULL,
	"mode" "match_mode" NOT NULL,
	"score" real NOT NULL,
	"components" jsonb NOT NULL,
	"explanation_keys" jsonb NOT NULL,
	"shown_on" date NOT NULL,
	"action" "suggestion_action",
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"context_kind" text NOT NULL,
	"context_id" text,
	"icebreaker_key" text,
	"first_message" text NOT NULL,
	"status" "message_request_status" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid,
	"kind" "message_kind" DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter" uuid,
	"target_user" uuid NOT NULL,
	"target_message" uuid,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "thread_members" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "thread_members_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "thread_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "thread_kind" NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"score" real NOT NULL,
	"multiplier" real NOT NULL,
	"components" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trust_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pair_companions" (
	"pair_id" uuid PRIMARY KEY NOT NULL,
	"seed" bigint NOT NULL,
	"stage" smallint DEFAULT 0 NOT NULL,
	"mood" "companion_mood" DEFAULT 'neutral' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pair_companions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pair_days" (
	"pair_id" uuid NOT NULL,
	"day" date NOT NULL,
	"a_count" integer NOT NULL,
	"b_count" integer NOT NULL,
	"outcome" "pair_day_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pair_days_pair_id_day_pk" PRIMARY KEY("pair_id","day")
);
--> statement-breakpoint
ALTER TABLE "pair_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"status" "pair_status" DEFAULT 'active' NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"freezes_available" smallint DEFAULT 0 NOT NULL,
	"missed_in_row" smallint DEFAULT 0 NOT NULL,
	"last_judged_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "pairs_ordered" CHECK ("pairs"."user_a" < "pairs"."user_b")
);
--> statement-breakpoint
ALTER TABLE "pairs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_users_id_fk" FOREIGN KEY ("blocker") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_users_id_fk" FOREIGN KEY ("blocked") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_suggestions" ADD CONSTRAINT "match_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_suggestions" ADD CONSTRAINT "match_suggestions_candidate_user_id_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_users_id_fk" FOREIGN KEY ("reporter") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_users_id_fk" FOREIGN KEY ("target_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_message_messages_id_fk" FOREIGN KEY ("target_message") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_companions" ADD CONSTRAINT "pair_companions_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_days" ADD CONSTRAINT "pair_days_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked");--> statement-breakpoint
CREATE INDEX "connections_user_b_idx" ON "connections" USING btree ("user_b");--> statement-breakpoint
CREATE UNIQUE INDEX "match_suggestions_user_candidate_day_key" ON "match_suggestions" USING btree ("user_id","candidate_user_id","shown_on");--> statement-breakpoint
CREATE INDEX "match_suggestions_user_day_idx" ON "match_suggestions" USING btree ("user_id","shown_on");--> statement-breakpoint
CREATE INDEX "match_suggestions_candidate_idx" ON "match_suggestions" USING btree ("candidate_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_requests_pending_pair_key" ON "message_requests" USING btree ("from_user","to_user") WHERE "message_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "message_requests_to_status_idx" ON "message_requests" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "message_requests_from_created_idx" ON "message_requests" USING btree ("from_user","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "reports_target_status_idx" ON "reports" USING btree ("target_user","status");--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" USING btree ("reporter");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "thread_members_user_idx" ON "thread_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pairs_open_pair_key" ON "pairs" USING btree ("user_a","user_b") WHERE "pairs"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "pairs_user_b_idx" ON "pairs" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "pairs_status_idx" ON "pairs" USING btree ("status");--> statement-breakpoint
create trigger message_requests_set_updated_at before update on message_requests
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger pair_companions_set_updated_at before update on pair_companions
  for each row execute function set_updated_at();
--> statement-breakpoint
-- Row Level Security (CLAUDE.md §5.9): members read the messages of threads they belong to, and
-- their own thread memberships, through Supabase Realtime. Every write goes through server code.
create policy messages_select on messages for select to authenticated
  using (exists (
    select 1 from thread_members tm
    where tm.thread_id = messages.thread_id and tm.user_id = auth.uid()
  ));
--> statement-breakpoint
create policy thread_members_select on thread_members for select to authenticated
  using (user_id = auth.uid());
--> statement-breakpoint
-- Realtime streams inserts on these tables to subscribed members, filtered by the policies above.
-- The publication exists on Supabase; plain Postgres (without it) skips this step.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table messages, thread_members, notifications;
  end if;
end $$;
