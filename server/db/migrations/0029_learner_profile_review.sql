ALTER TABLE "member_cohorts" ALTER COLUMN "season" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_cohorts" ADD COLUMN "season_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "member_cohorts" SET "season_enabled" = "active";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "is_learner" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO roles (code, name) VALUES ('reader', '学员（只读）') ON CONFLICT (code) DO NOTHING;
