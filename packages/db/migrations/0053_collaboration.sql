CREATE TYPE "public"."adoption_status" AS ENUM('requested', 'active', 'revived', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('starter', 'escrow', 'release', 'refund', 'admin_adjust');--> statement-breakpoint
CREATE TYPE "public"."legacy_source" AS ENUM('showcase', 'fyp');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('listed', 'adopted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."review_rating" AS ENUM('helpful', 'unhelpful');--> statement-breakpoint
CREATE TYPE "public"."review_request_status" AS ENUM('open', 'claimed', 'submitted', 'settled_helpful', 'settled_unhelpful', 'expired', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."swap_proposal_status" AS ENUM('proposed', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."swap_response" AS ENUM('accept', 'decline');--> statement-breakpoint
CREATE TABLE "adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid,
	"repo_github_id" bigint NOT NULL,
	"adopter_user_id" uuid NOT NULL,
	"fork_full_name" "citext",
	"status" "adoption_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "adoptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "graveyard_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" "listing_status" DEFAULT 'listed' NOT NULL,
	"note" text,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graveyard_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_locks" (
	"user_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legacy_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"source" "legacy_source" NOT NULL,
	"grad_year" smallint,
	"tags" text[] NOT NULL,
	"blurb" text,
	"accepts_questions" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_suggestions" (
	"owner_user_id" uuid NOT NULL,
	"repo_github_id" bigint NOT NULL,
	"suggested_at" timestamp with time zone NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_suggestions_owner_user_id_repo_github_id_pk" PRIMARY KEY("owner_user_id","repo_github_id")
);
--> statement-breakpoint
ALTER TABLE "listing_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oss_member_contribs" (
	"user_id" uuid NOT NULL,
	"repo_full_name" "citext" NOT NULL,
	"merged_prs" integer NOT NULL,
	"last_merged_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oss_member_contribs_user_id_repo_full_name_pk" PRIMARY KEY("user_id","repo_full_name")
);
--> statement-breakpoint
ALTER TABLE "oss_member_contribs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"pr_url" text NOT NULL,
	"repo_full_name" "citext" NOT NULL,
	"pr_number" integer NOT NULL,
	"languages" text[] NOT NULL,
	"status" "review_request_status" DEFAULT 'open' NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"gh_review_ids" bigint[] NOT NULL,
	"line_comment_count" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"rating" "review_rating",
	"rated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swap_offers" (
	"user_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"level" real NOT NULL,
	"verified" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_offers_user_id_tag_pk" PRIMARY KEY("user_id","tag")
);
--> statement-breakpoint
ALTER TABLE "swap_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swap_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"members" uuid[] NOT NULL,
	"edges" jsonb NOT NULL,
	"quality" real NOT NULL,
	"status" "swap_proposal_status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swap_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swap_responses" (
	"proposal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"response" "swap_response" NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_responses_proposal_id_user_id_pk" PRIMARY KEY("proposal_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "swap_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swap_wants" (
	"user_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"priority" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_wants_user_id_tag_pk" PRIMARY KEY("user_id","tag")
);
--> statement-breakpoint
ALTER TABLE "swap_wants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_listing_id_graveyard_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."graveyard_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adoptions" ADD CONSTRAINT "adoptions_adopter_user_id_users_id_fk" FOREIGN KEY ("adopter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graveyard_listings" ADD CONSTRAINT "graveyard_listings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_locks" ADD CONSTRAINT "ledger_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_entries" ADD CONSTRAINT "legacy_entries_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_entries" ADD CONSTRAINT "legacy_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_suggestions" ADD CONSTRAINT "listing_suggestions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oss_member_contribs" ADD CONSTRAINT "oss_member_contribs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_offers" ADD CONSTRAINT "swap_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_proposals" ADD CONSTRAINT "swap_proposals_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_responses" ADD CONSTRAINT "swap_responses_proposal_id_swap_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."swap_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_responses" ADD CONSTRAINT "swap_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_wants" ADD CONSTRAINT "swap_wants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adoptions_adopter_idx" ON "adoptions" USING btree ("adopter_user_id");--> statement-breakpoint
CREATE INDEX "adoptions_listing_idx" ON "adoptions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "adoptions_status_idx" ON "adoptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_request_idx" ON "credit_ledger" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "graveyard_listings_open_repo_key" ON "graveyard_listings" USING btree ("repo_github_id") WHERE "graveyard_listings"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "graveyard_listings_owner_idx" ON "graveyard_listings" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "graveyard_listings_status_idx" ON "graveyard_listings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_entries_owner_repo_key" ON "legacy_entries" USING btree ("owner_user_id","repo_github_id");--> statement-breakpoint
CREATE INDEX "legacy_entries_university_idx" ON "legacy_entries" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "legacy_entries_tags_idx" ON "legacy_entries" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "oss_member_contribs_repo_idx" ON "oss_member_contribs" USING btree ("repo_full_name");--> statement-breakpoint
CREATE INDEX "review_requests_university_status_idx" ON "review_requests" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "review_requests_author_idx" ON "review_requests" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "review_requests_claimed_by_idx" ON "review_requests" USING btree ("claimed_by");--> statement-breakpoint
CREATE INDEX "review_requests_expires_idx" ON "review_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_idx" ON "reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "swap_offers_tag_idx" ON "swap_offers" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "swap_proposals_status_idx" ON "swap_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "swap_proposals_members_idx" ON "swap_proposals" USING gin ("members");--> statement-breakpoint
CREATE INDEX "swap_responses_user_idx" ON "swap_responses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "swap_wants_tag_idx" ON "swap_wants" USING btree ("tag");--> statement-breakpoint
create trigger graveyard_listings_set_updated_at before update on graveyard_listings
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger adoptions_set_updated_at before update on adoptions
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger review_requests_set_updated_at before update on review_requests
  for each row execute function set_updated_at();
--> statement-breakpoint
create trigger legacy_entries_set_updated_at before update on legacy_entries
  for each row execute function set_updated_at();
--> statement-breakpoint
-- The credit ledger is append-only (CLAUDE.md §7.8, §8 F15). Rows change only by being added; the
-- one exception is account deletion, whose cascade runs after the member's users row is gone.
-- Truncation needs the table owner; the browser roles lose it below and the app never truncates.
create function credit_ledger_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from users where id = old.user_id) then
    return old;
  end if;
  raise exception 'credit_ledger is append-only: % is not allowed', lower(tg_op) using errcode = 'insufficient_privilege';
end $$;
--> statement-breakpoint
create trigger credit_ledger_append_only before update or delete on credit_ledger
  for each row execute function credit_ledger_append_only();
--> statement-breakpoint
revoke update, delete, truncate on credit_ledger from anon, authenticated;
--> statement-breakpoint
-- Balances are a sum, never stored. Callers' own permissions (and so Row Level Security) apply.
create view credit_balances with (security_invoker = true) as
  select user_id, sum(delta)::int as balance from credit_ledger group by user_id;
