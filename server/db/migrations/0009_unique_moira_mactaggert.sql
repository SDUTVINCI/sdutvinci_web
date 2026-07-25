CREATE TABLE "article_deletion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"operation" varchar(16) NOT NULL,
	"article_path" text NOT NULL,
	"source_commit_hash" varchar(64) NOT NULL,
	"commit_hash" varchar(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_deletion_events_operation_check" CHECK ("article_deletion_events"."operation" in ('delete', 'restore'))
);
--> statement-breakpoint
DROP INDEX "drafts_article_owner_unique";--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD CONSTRAINT "article_deletion_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_deletion_events" ADD CONSTRAINT "article_deletion_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_deletion_events_article_id_index" ON "article_deletion_events" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_deletion_events_actor_user_id_index" ON "article_deletion_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "article_deletion_events_created_at_index" ON "article_deletion_events" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_deleted_at_index" ON "articles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "drafts_deleted_at_index" ON "drafts" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_article_owner_unique" ON "drafts" USING btree ("article_id","owner_user_id") WHERE "drafts"."deleted_at" is null;