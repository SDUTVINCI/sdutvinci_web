CREATE TABLE "content_reconciliation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"error_code" varchar(64),
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "content_reconciliation_requests_status_check" CHECK ("content_reconciliation_requests"."status" in ('pending', 'processing', 'succeeded', 'failed', 'busy'))
);
--> statement-breakpoint
ALTER TABLE "content_reconciliation_requests" ADD CONSTRAINT "content_reconciliation_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reconciliation_requests_status_index" ON "content_reconciliation_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_reconciliation_requests_user_index" ON "content_reconciliation_requests" USING btree ("requested_by_user_id","created_at");