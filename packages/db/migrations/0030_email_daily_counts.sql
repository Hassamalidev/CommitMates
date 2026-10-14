CREATE TABLE "email_daily_counts" (
	"day" date PRIMARY KEY NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_daily_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
create trigger email_daily_counts_set_updated_at before update on email_daily_counts
  for each row execute function set_updated_at();
