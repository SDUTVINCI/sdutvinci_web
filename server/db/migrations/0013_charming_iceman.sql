CREATE TABLE "content_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"revision_id" uuid,
	"operation" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"exported_commit_hash" varchar(64),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_export_jobs_target_type_check" CHECK ("content_export_jobs"."target_type" in ('article', 'member')),
	CONSTRAINT "content_export_jobs_operation_check" CHECK ("content_export_jobs"."operation" in ('create', 'update', 'move', 'delete', 'member_update')),
	CONSTRAINT "content_export_jobs_status_check" CHECK ("content_export_jobs"."status" in ('pending', 'processing', 'succeeded', 'failed')),
	CONSTRAINT "content_export_jobs_attempt_count_check" CHECK ("content_export_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "article_deletion_events" ALTER COLUMN "source_commit_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ALTER COLUMN "commit_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD COLUMN "source_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD COLUMN "result_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD COLUMN "export_job_id" uuid;--> statement-breakpoint
ALTER TABLE "content_export_jobs" ADD CONSTRAINT "content_export_jobs_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_export_jobs_idempotency_key_unique" ON "content_export_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_export_jobs_revision_operation_unique" ON "content_export_jobs" USING btree ("revision_id","operation") WHERE "content_export_jobs"."revision_id" is not null;--> statement-breakpoint
CREATE INDEX "content_export_jobs_pending_index" ON "content_export_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "content_export_jobs_target_index" ON "content_export_jobs" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "content_export_jobs_revision_id_index" ON "content_export_jobs" USING btree ("revision_id");--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD CONSTRAINT "article_deletion_events_source_revision_id_article_revisions_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD CONSTRAINT "article_deletion_events_result_revision_id_article_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD CONSTRAINT "article_deletion_events_export_job_id_content_export_jobs_id_fk" FOREIGN KEY ("export_job_id") REFERENCES "public"."content_export_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_deletion_events_source_revision_id_index" ON "article_deletion_events" USING btree ("source_revision_id");--> statement-breakpoint
CREATE INDEX "article_deletion_events_result_revision_id_index" ON "article_deletion_events" USING btree ("result_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_deletion_events_export_job_unique" ON "article_deletion_events" USING btree ("export_job_id");