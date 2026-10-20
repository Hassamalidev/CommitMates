CREATE TABLE "persona_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"metrics" jsonb NOT NULL,
	"labels" text[] NOT NULL,
	"companion" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_snapshots_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "persona_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "persona_snapshots" ADD CONSTRAINT "persona_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
create trigger persona_snapshots_set_updated_at before update on persona_snapshots
  for each row execute function set_updated_at();
