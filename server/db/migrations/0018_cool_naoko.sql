CREATE TABLE "member_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_token_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'editing' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avatar_object_key" text,
	"avatar_public_url" text,
	"avatar_byte_size" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"review_note" text,
	"approved_member_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_applications_status_check" CHECK ("member_applications"."status" in ('editing', 'submitted', 'approved', 'rejected', 'abandoned')),
	CONSTRAINT "member_applications_avatar_byte_size_check" CHECK ("member_applications"."avatar_byte_size" is null or "member_applications"."avatar_byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade_year" integer NOT NULL,
	"season" varchar(16) NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_cohorts_grade_year_check" CHECK ("member_cohorts"."grade_year" between 2000 and 2200)
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "group_name" varchar(64);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "positions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "member_applications" ADD CONSTRAINT "member_applications_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_applications" ADD CONSTRAINT "member_applications_approved_member_id_members_id_fk" FOREIGN KEY ("approved_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_applications_access_token_hash_unique" ON "member_applications" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "member_applications_avatar_object_key_unique" ON "member_applications" USING btree ("avatar_object_key");--> statement-breakpoint
CREATE INDEX "member_applications_status_created_index" ON "member_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "member_applications_expires_at_index" ON "member_applications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_cohorts_grade_year_unique" ON "member_cohorts" USING btree ("grade_year");--> statement-breakpoint
CREATE UNIQUE INDEX "member_cohorts_season_unique" ON "member_cohorts" USING btree ("season");--> statement-breakpoint
CREATE INDEX "member_cohorts_active_index" ON "member_cohorts" USING btree ("active","grade_year");
--> statement-breakpoint
INSERT INTO "member_cohorts" ("grade_year", "season", "groups") VALUES
  (2016, '18', '["机械组","电控组","运营组"]'::jsonb),
  (2017, '19', '["机械组","电控组","运营组"]'::jsonb),
  (2018, '20', '["机械组","电控组","运营组"]'::jsonb),
  (2019, '21', '["机械组","电控组","运营组"]'::jsonb),
  (2020, '22', '["机械组","电控组","运营组"]'::jsonb),
  (2021, '23', '["机械组","电控组","运营组"]'::jsonb),
  (2022, '24', '["机械组","控制组","电路组","视觉算法组","运营组"]'::jsonb),
  (2023, '25', '["机械组","控制组","电路组","视觉算法组","运营组"]'::jsonb),
  (2024, '26', '["机械组","控制组","电路组","视觉算法组","运营组"]'::jsonb),
  (2025, '27', '["机械组","嵌入式组","软件算法组","运营组"]'::jsonb);
--> statement-breakpoint
UPDATE "members" SET
  "group_name" = CASE
    WHEN coalesce("role", '') LIKE '%机械组%' OR coalesce("member_type", '') LIKE '%机械组%' THEN '机械组'
    WHEN coalesce("role", '') LIKE '%电控组%' OR coalesce("member_type", '') LIKE '%电控组%' THEN '电控组'
    WHEN coalesce("role", '') LIKE '%控制组%' OR coalesce("member_type", '') LIKE '%控制组%' THEN '控制组'
    WHEN coalesce("role", '') LIKE '%电路组%' OR coalesce("member_type", '') LIKE '%电路组%' THEN '电路组'
    WHEN coalesce("role", '') LIKE '%算法组%' OR coalesce("member_type", '') LIKE '%算法组%' THEN '算法组'
    WHEN coalesce("role", '') LIKE '%运营组%' OR coalesce("member_type", '') LIKE '%运营组%' THEN '运营组'
    ELSE NULL END,
  "positions" = to_jsonb(array_remove(ARRAY[
    CASE WHEN coalesce("role", '') LIKE '%队长%' AND coalesce("role", '') NOT LIKE '%副队长%' THEN '队长' END,
    CASE WHEN coalesce("role", '') LIKE '%副队长%' THEN '副队长' END,
    CASE WHEN coalesce("role", '') LIKE '%组长%' THEN '组长' END,
    CASE WHEN coalesce("role", '') LIKE '%机电创新学会会长%' THEN '机电创新学会会长' END,
    CASE WHEN coalesce("role", '') LIKE '%指导老师%' OR coalesce("member_type", '') LIKE '%指导老师%' THEN '指导老师' END,
    CASE WHEN coalesce("role", '') LIKE '%成员%' THEN '成员' END,
    CASE WHEN coalesce("member_type", '') LIKE '%顾问%' THEN '顾问' END
  ], NULL));
