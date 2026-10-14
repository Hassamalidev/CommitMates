-- Salts now come in two kinds with different lifetimes: daily `ip` salts and `aggregate`
-- salts that last privacy.aggregateSaltRotationDays. Salts are disposable random values and
-- nothing has written one yet, so existing rows (none) are cleared rather than migrated.
CREATE TYPE "public"."salt_kind" AS ENUM('ip', 'aggregate');--> statement-breakpoint
DELETE FROM "salts";--> statement-breakpoint
ALTER TABLE "salts" ADD COLUMN "kind" "salt_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "salts" DROP CONSTRAINT "salts_pkey";--> statement-breakpoint
ALTER TABLE "salts" ADD CONSTRAINT "salts_kind_period_pk" PRIMARY KEY("kind","period");
