CREATE TABLE "content_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"collection" varchar(32) NOT NULL,
	"relative_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_import_items_collection_check" CHECK ("content_import_items"."collection" in ('news', 'wiki')),
	CONSTRAINT "content_import_items_status_check" CHECK ("content_import_items"."status" in ('validated', 'imported', 'failed')),
	CONSTRAINT "content_import_items_sha_check" CHECK ("content_import_items"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "content_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'dry_run' NOT NULL,
	"source_commit_hash" varchar(64),
	"snapshot_sha256" varchar(64) NOT NULL,
	"confirmation_hash" varchar(64),
	"actor_label" varchar(128) NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_summary" text,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_import_runs_mode_check" CHECK ("content_import_runs"."mode" in ('empty_database_initialization', 'disaster_recovery')),
	CONSTRAINT "content_import_runs_status_check" CHECK ("content_import_runs"."status" in ('dry_run', 'succeeded', 'failed')),
	CONSTRAINT "content_import_runs_item_count_check" CHECK ("content_import_runs"."item_count" >= 0),
	CONSTRAINT "content_import_runs_snapshot_sha_check" CHECK ("content_import_runs"."snapshot_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "content_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'processing' NOT NULL,
	"base_commit_hash" varchar(64),
	"result_commit_hash" varchar(64),
	"report_sha256" varchar(64),
	"report_path" text,
	"added_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"modified_count" integer DEFAULT 0 NOT NULL,
	"extra_count" integer DEFAULT 0 NOT NULL,
	"metadata_mismatch_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_summary" text,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_reconciliation_runs_trigger_check" CHECK ("content_reconciliation_runs"."trigger" in ('schedule', 'manual')),
	CONSTRAINT "content_reconciliation_runs_status_check" CHECK ("content_reconciliation_runs"."status" in ('processing', 'succeeded', 'failed', 'busy')),
	CONSTRAINT "content_reconciliation_runs_added_check" CHECK ("content_reconciliation_runs"."added_count" >= 0),
	CONSTRAINT "content_reconciliation_runs_missing_check" CHECK ("content_reconciliation_runs"."missing_count" >= 0),
	CONSTRAINT "content_reconciliation_runs_modified_check" CHECK ("content_reconciliation_runs"."modified_count" >= 0),
	CONSTRAINT "content_reconciliation_runs_extra_check" CHECK ("content_reconciliation_runs"."extra_count" >= 0),
	CONSTRAINT "content_reconciliation_runs_metadata_check" CHECK ("content_reconciliation_runs"."metadata_mismatch_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "content_import_items" ADD CONSTRAINT "content_import_items_run_id_content_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."content_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_import_items_run_article_unique" ON "content_import_items" USING btree ("run_id","article_id");--> statement-breakpoint
CREATE INDEX "content_import_items_run_index" ON "content_import_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "content_import_runs_started_index" ON "content_import_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "content_import_runs_status_index" ON "content_import_runs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "content_reconciliation_runs_started_index" ON "content_reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "content_reconciliation_runs_status_index" ON "content_reconciliation_runs" USING btree ("status","completed_at");