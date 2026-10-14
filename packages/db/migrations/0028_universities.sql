CREATE TYPE "public"."university_source" AS ENUM('hipo', 'admin');--> statement-breakpoint
CREATE TABLE "disposable_domains" (
	"domain" "citext" PRIMARY KEY NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disposable_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "universities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"state_province" text,
	"web_pages" text[] NOT NULL,
	"source" "university_source" NOT NULL,
	"source_key" text,
	"source_missing" boolean DEFAULT false NOT NULL,
	"checksum" text NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "university_domains" (
	"domain" "citext" NOT NULL,
	"university_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "university_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "university_domains" ADD CONSTRAINT "university_domains_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "universities_slug_key" ON "universities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "universities_source_key_key" ON "universities" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "universities_country_code_idx" ON "universities" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "university_domains_domain_university_key" ON "university_domains" USING btree ("domain","university_id");--> statement-breakpoint
CREATE INDEX "university_domains_university_idx" ON "university_domains" USING btree ("university_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
create trigger universities_set_updated_at before update on universities
  for each row execute function set_updated_at();
