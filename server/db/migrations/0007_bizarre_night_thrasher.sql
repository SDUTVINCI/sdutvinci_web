CREATE TABLE "publish_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"article_id" uuid,
	"operator_user_id" uuid,
	"reviewer_user_id" uuid,
	"operation" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"commit_hash" varchar(64),
	"article_path" text NOT NULL,
	"message" text NOT NULL,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "publish_records_operation_check" CHECK ("publish_records"."operation" in ('publish', 'restore')),
	CONSTRAINT "publish_records_status_check" CHECK ("publish_records"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_records_draft_id_index" ON "publish_records" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "publish_records_article_id_index" ON "publish_records" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "publish_records_operator_user_id_index" ON "publish_records" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "publish_records_created_at_index" ON "publish_records" USING btree ("created_at");