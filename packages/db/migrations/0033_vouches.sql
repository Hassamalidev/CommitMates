CREATE TABLE "vouches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_user_id" uuid NOT NULL,
	"vouchee_user_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouches_not_self" CHECK ("vouches"."voucher_user_id" <> "vouches"."vouchee_user_id")
);
--> statement-breakpoint
ALTER TABLE "vouches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vouches" ADD CONSTRAINT "vouches_voucher_user_id_users_id_fk" FOREIGN KEY ("voucher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouches" ADD CONSTRAINT "vouches_vouchee_user_id_users_id_fk" FOREIGN KEY ("vouchee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouches" ADD CONSTRAINT "vouches_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vouches_voucher_vouchee_key" ON "vouches" USING btree ("voucher_user_id","vouchee_user_id");--> statement-breakpoint
CREATE INDEX "vouches_vouchee_university_idx" ON "vouches" USING btree ("vouchee_user_id","university_id");