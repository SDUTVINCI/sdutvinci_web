CREATE TABLE "content_export_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'processing' NOT NULL,
	"worker_id" varchar(128),
	"base_commit_hash" varchar(64),
	"local_commit_hash" varchar(64),
	"result_commit_hash" varchar(64),
	"job_count" integer DEFAULT 0 NOT NULL,
	"file_write_count" integer DEFAULT 0 NOT NULL,
	"file_delete_count" integer DEFAULT 0 NOT NULL,
	"noop_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_summary" text,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_export_runs_trigger_check" CHECK ("content_export_runs"."trigger" in ('worker', 'manual_retry', 'takeover')),
	CONSTRAINT "content_export_runs_status_check" CHECK ("content_export_runs"."status" in ('processing', 'succeeded', 'failed')),
	CONSTRAINT "content_export_runs_job_count_check" CHECK ("content_export_runs"."job_count" >= 0),
	CONSTRAINT "content_export_runs_file_write_count_check" CHECK ("content_export_runs"."file_write_count" >= 0),
	CONSTRAINT "content_export_runs_file_delete_count_check" CHECK ("content_export_runs"."file_delete_count" >= 0),
	CONSTRAINT "content_export_runs_noop_count_check" CHECK ("content_export_runs"."noop_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "last_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "target_path" text;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "previous_path" text;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "expected_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "lease_owner" varchar(128);--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "latest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "exported_path" text;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD COLUMN "exported_sha256" varchar(64);--> statement-breakpoint
CREATE INDEX "content_export_runs_status_started_index" ON "content_export_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "content_export_runs_completed_at_index" ON "content_export_runs" USING btree ("completed_at");--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD CONSTRAINT "content_export_jobs_latest_run_id_content_export_runs_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "public"."content_export_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_export_jobs_lease_index" ON "content_export_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "content_export_jobs_latest_run_id_index" ON "content_export_jobs" USING btree ("latest_run_id");--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD CONSTRAINT "content_export_jobs_expected_sha256_check" CHECK ("content_export_jobs"."expected_sha256" is null or "content_export_jobs"."expected_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD CONSTRAINT "content_export_jobs_exported_sha256_check" CHECK ("content_export_jobs"."exported_sha256" is null or "content_export_jobs"."exported_sha256" ~ '^[0-9a-f]{64}$');