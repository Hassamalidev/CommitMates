CREATE TABLE "skill_vectors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"base" jsonb NOT NULL,
	"vector" jsonb NOT NULL,
	"top_tags" text[] NOT NULL,
	"interests" text[] NOT NULL,
	"cluster_label" text,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_vectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_vectors" ADD CONSTRAINT "skill_vectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_vectors_computed_idx" ON "skill_vectors" USING btree ("computed_at");--> statement-breakpoint
create trigger skill_vectors_set_updated_at before update on skill_vectors
  for each row execute function set_updated_at();
