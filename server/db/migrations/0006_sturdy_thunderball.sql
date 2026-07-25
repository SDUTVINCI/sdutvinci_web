CREATE TABLE "edit_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"holder_user_id" uuid NOT NULL,
	"lease_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "edit_locks_target_type_check" CHECK ("edit_locks"."target_type" in ('article', 'draft'))
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(32) NOT NULL,
	"from_status" varchar(32) NOT NULL,
	"to_status" varchar(32) NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_action_check" CHECK ("review_events"."action" in ('submitted', 'withdrawn', 'rejected', 'approved', 'reopened', 'resynced'))
);
--> statement-breakpoint
ALTER TABLE "drafts" DROP CONSTRAINT "drafts_status_check";--> statement-breakpoint
ALTER TABLE "edit_locks" ADD CONSTRAINT "edit_locks_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edit_locks_target_unique" ON "edit_locks" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_locks_lease_id_unique" ON "edit_locks" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "edit_locks_holder_user_id_index" ON "edit_locks" USING btree ("holder_user_id");--> statement-breakpoint
CREATE INDEX "edit_locks_expires_at_index" ON "edit_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "review_events_draft_id_index" ON "review_events" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "review_events_actor_user_id_index" ON "review_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "review_events_created_at_index" ON "review_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "drafts_status_index" ON "drafts" USING btree ("status");--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_status_check" CHECK ("drafts"."status" in ('draft', 'pending_review', 'rejected', 'approved', 'published', 'withdrawn'));