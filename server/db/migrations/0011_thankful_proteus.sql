CREATE TABLE "article_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"markdown_source" text NOT NULL,
	"body" text NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_kind" varchar(32) DEFAULT 'backfill' NOT NULL,
	"source_draft_id" uuid,
	"published_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"restored_from_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_revisions_number_check" CHECK ("article_revisions"."revision_number" >= 1),
	CONSTRAINT "article_revisions_content_hash_check" CHECK ("article_revisions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "article_revisions_source_kind_check" CHECK ("article_revisions"."source_kind" in ('backfill', 'publish', 'restore', 'member_publish'))
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "base_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_source_draft_id_drafts_id_fk" FOREIGN KEY ("source_draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_restored_from_revision_id_article_revisions_id_fk" FOREIGN KEY ("restored_from_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_article_number_unique" ON "article_revisions" USING btree ("article_id","revision_number");--> statement-breakpoint
CREATE INDEX "article_revisions_article_created_at_index" ON "article_revisions" USING btree ("article_id","created_at");--> statement-breakpoint
CREATE INDEX "article_revisions_content_hash_index" ON "article_revisions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "article_revisions_source_draft_id_index" ON "article_revisions" USING btree ("source_draft_id");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_revision_id_article_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_base_revision_id_article_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE restrict ON UPDATE no action;