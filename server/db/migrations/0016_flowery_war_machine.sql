CREATE TABLE "article_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"from_public_path" text NOT NULL,
	"to_public_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pr_external_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"external_reference" varchar(128),
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_pr_external_actions_action_check" CHECK ("content_pr_external_actions"."action" in ('comment', 'close')),
	CONSTRAINT "content_pr_external_actions_status_check" CHECK ("content_pr_external_actions"."status" in ('processing', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "content_pr_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"change_type" varchar(16) NOT NULL,
	"classification" varchar(32) NOT NULL,
	"importable" boolean DEFAULT false NOT NULL,
	"old_path" text,
	"new_path" text,
	"article_id" uuid,
	"base_revision_id" uuid,
	"current_revision_id" uuid,
	"proposed_article_id" uuid DEFAULT gen_random_uuid(),
	"base_source" text,
	"current_source" text,
	"proposed_source" text,
	"merged_source" text,
	"base_sha256" varchar(64),
	"current_sha256" varchar(64),
	"proposed_sha256" varchar(64),
	"merged_sha256" varchar(64),
	"warning_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"draft_id" uuid,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pr_import_items_ordinal_check" CHECK ("content_pr_import_items"."ordinal" >= 0),
	CONSTRAINT "content_pr_import_items_change_type_check" CHECK ("content_pr_import_items"."change_type" in ('added', 'modified', 'renamed', 'removed', 'invalid')),
	CONSTRAINT "content_pr_import_items_classification_check" CHECK ("content_pr_import_items"."classification" in ('safe_change', 'auto_merge', 'content_conflict', 'new_article', 'move_or_rename', 'deletion_proposal', 'path_conflict', 'invalid_file', 'unknown_syntax', 'high_risk_syntax')),
	CONSTRAINT "content_pr_import_items_status_check" CHECK ("content_pr_import_items"."status" in ('pending', 'imported', 'skipped', 'blocked')),
	CONSTRAINT "content_pr_import_items_proposed_id_check" CHECK (("content_pr_import_items"."classification" = 'new_article' and "content_pr_import_items"."article_id" is null and "content_pr_import_items"."proposed_article_id" is not null) or ("content_pr_import_items"."classification" <> 'new_article' and "content_pr_import_items"."proposed_article_id" is null))
);
--> statement-breakpoint
CREATE TABLE "content_pr_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" varchar(200) NOT NULL,
	"pull_request_number" integer NOT NULL,
	"base_commit_hash" varchar(64) NOT NULL,
	"head_commit_hash" varchar(64) NOT NULL,
	"base_snapshot_sha256" varchar(64) NOT NULL,
	"actor_user_id" uuid,
	"pr_author_label" varchar(128),
	"status" varchar(32) DEFAULT 'dry_run' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"importable_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(64),
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_pr_import_runs_pr_check" CHECK ("content_pr_import_runs"."pull_request_number" > 0),
	CONSTRAINT "content_pr_import_runs_base_commit_check" CHECK ("content_pr_import_runs"."base_commit_hash" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "content_pr_import_runs_head_commit_check" CHECK ("content_pr_import_runs"."head_commit_hash" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "content_pr_import_runs_snapshot_check" CHECK ("content_pr_import_runs"."base_snapshot_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "content_pr_import_runs_status_check" CHECK ("content_pr_import_runs"."status" in ('dry_run', 'partially_imported', 'imported', 'failed')),
	CONSTRAINT "content_pr_import_runs_item_count_check" CHECK ("content_pr_import_runs"."item_count" >= 0),
	CONSTRAINT "content_pr_import_runs_importable_count_check" CHECK ("content_pr_import_runs"."importable_count" >= 0),
	CONSTRAINT "content_pr_import_runs_imported_count_check" CHECK ("content_pr_import_runs"."imported_count" >= 0),
	CONSTRAINT "content_pr_import_runs_conflict_count_check" CHECK ("content_pr_import_runs"."conflict_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "proposed_action" varchar(16) DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "proposed_relative_path" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "proposed_article_id" uuid;--> statement-breakpoint
INSERT INTO "roles" ("code", "name") VALUES ('content_importer', '外部内容导入') ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "article_redirects" ADD CONSTRAINT "article_redirects_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_external_actions" ADD CONSTRAINT "content_pr_external_actions_run_id_content_pr_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."content_pr_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_external_actions" ADD CONSTRAINT "content_pr_external_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_run_id_content_pr_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."content_pr_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_base_revision_id_article_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_current_revision_id_article_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_items" ADD CONSTRAINT "content_pr_import_items_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pr_import_runs" ADD CONSTRAINT "content_pr_import_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_redirects_from_path_unique" ON "article_redirects" USING btree ("from_public_path");--> statement-breakpoint
CREATE INDEX "article_redirects_article_index" ON "article_redirects" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "content_pr_external_actions_run_index" ON "content_pr_external_actions" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pr_import_items_run_ordinal_unique" ON "content_pr_import_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "content_pr_import_items_run_index" ON "content_pr_import_items" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "content_pr_import_items_article_index" ON "content_pr_import_items" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "content_pr_import_items_draft_index" ON "content_pr_import_items" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pr_import_runs_pr_head_unique" ON "content_pr_import_runs" USING btree ("repository_id","pull_request_number","head_commit_hash");--> statement-breakpoint
CREATE INDEX "content_pr_import_runs_started_index" ON "content_pr_import_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "content_pr_import_runs_actor_index" ON "content_pr_import_runs" USING btree ("actor_user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_proposed_article_id_unique" ON "drafts" USING btree ("proposed_article_id") WHERE "drafts"."proposed_article_id" is not null;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_proposed_action_check" CHECK ("drafts"."proposed_action" in ('edit', 'move', 'delete'));--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_proposed_path_check" CHECK (("drafts"."proposed_action" = 'move' and "drafts"."proposed_relative_path" is not null) or ("drafts"."proposed_action" <> 'move'));
