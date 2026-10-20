CREATE TYPE "public"."pair_invite_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "pair_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"status" "pair_invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pair_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pair_invites" ADD CONSTRAINT "pair_invites_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_invites" ADD CONSTRAINT "pair_invites_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_invites" ADD CONSTRAINT "pair_invites_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pair_invites_pending_key" ON "pair_invites" USING btree ("from_user","to_user") WHERE "pair_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pair_invites_to_status_idx" ON "pair_invites" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "pair_invites_thread_idx" ON "pair_invites" USING btree ("thread_id");