CREATE TABLE "member_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"current_revision_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"proposed_profile" jsonb,
	"field_changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_import_item_id" uuid,
	"created_by_user_id" uuid,
	"applied_by_user_id" uuid,
	"applied_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "member_proposals_action_check" CHECK ("member_proposals"."action" in ('update', 'delete')),
	CONSTRAINT "member_proposals_status_check" CHECK ("member_proposals"."status" in ('pending', 'conflicted', 'applied', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "member_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"member_key" varchar(100) NOT NULL,
	"source_path" text NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"markdown_source" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_kind" varchar(32) NOT NULL,
	"actor_user_id" uuid,
	"restored_from_revision_id" uuid,
	"source_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_revisions_number_check" CHECK ("member_revisions"."revision_number" >= 1),
	CONSTRAINT "member_revisions_hash_check" CHECK ("member_revisions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "member_revisions_source_kind_check" CHECK ("member_revisions"."source_kind" in ('backfill', 'cms_create', 'cms_update', 'proposal_apply', 'restore', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "content_pr_import_items" DROP CONSTRAINT "content_pr_import_items_classification_check";--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "member_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD COLUMN "target_type" varchar(16) DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD COLUMN "member_id" uuid;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD COLUMN "base_member_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD COLUMN "current_member_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD COLUMN "member_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "member_type" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "seasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "advisor_seasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "grade" varchar(32);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "affiliation" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_base_revision_id_member_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_current_revision_id_member_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_source_import_item_id_content_pr_import_items_id_fk" FOREIGN KEY ("source_import_item_id") REFERENCES "public"."content_pr_import_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_proposals" ADD CONSTRAINT "member_proposals_applied_revision_id_member_revisions_id_fk" FOREIGN KEY ("applied_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_revisions" ADD CONSTRAINT "member_revisions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_revisions" ADD CONSTRAINT "member_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_revisions" ADD CONSTRAINT "member_revisions_restored_from_revision_id_member_revisions_id_fk" FOREIGN KEY ("restored_from_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_revisions" ADD CONSTRAINT "member_revisions_source_proposal_id_member_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."member_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_proposals_import_item_unique" ON "member_proposals" USING btree ("source_import_item_id");--> statement-breakpoint
CREATE INDEX "member_proposals_member_status_index" ON "member_proposals" USING btree ("member_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_revisions_member_number_unique" ON "member_revisions" USING btree ("member_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "member_revisions_source_proposal_unique" ON "member_revisions" USING btree ("source_proposal_id");--> statement-breakpoint
CREATE INDEX "member_revisions_member_created_index" ON "member_revisions" USING btree ("member_id","created_at");--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD CONSTRAINT "content_export_jobs_member_revision_id_member_revisions_id_fk" FOREIGN KEY ("member_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_base_member_revision_id_member_revisions_id_fk" FOREIGN KEY ("base_member_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_current_member_revision_id_member_revisions_id_fk" FOREIGN KEY ("current_member_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_member_proposal_id_member_proposals_id_fk" FOREIGN KEY ("member_proposal_id") REFERENCES "public"."member_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_current_revision_id_member_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."member_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_export_jobs_member_revision_operation_unique" ON "content_export_jobs" USING btree ("member_revision_id","operation") WHERE "content_export_jobs"."member_revision_id" is not null;--> statement-breakpoint
CREATE INDEX "content_export_jobs_member_revision_id_index" ON "content_export_jobs" USING btree ("member_revision_id");--> statement-breakpoint
CREATE INDEX "content_pr_import_items_member_index" ON "content_pr_import_items" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "content_pr_import_items_member_proposal_index" ON "content_pr_import_items" USING btree ("member_proposal_id");--> statement-breakpoint
CREATE INDEX "members_deleted_at_index" ON "members" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "members_sort_index" ON "members" USING btree ("sort_order","member_key");--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_target_type_check" CHECK ("content_pr_import_items"."target_type" in ('article', 'member'));--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_classification_check" CHECK ("content_pr_import_items"."classification" in ('safe_change', 'auto_merge', 'content_conflict', 'new_article', 'move_or_rename', 'deletion_proposal', 'path_conflict', 'invalid_file', 'unknown_syntax', 'high_risk_syntax', 'member_safe_change', 'member_auto_merge', 'member_conflict', 'member_deletion_proposal', 'member_sensitive_rejected', 'member_invalid'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_version_check" CHECK ("members"."version" >= 1);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_sort_order_check" CHECK ("members"."sort_order" >= 0);