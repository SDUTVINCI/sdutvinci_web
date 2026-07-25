CREATE TABLE "draft_authors" (
	"draft_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_authors_primary_key" PRIMARY KEY("draft_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"collection" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"preserved_frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_content_hash" varchar(64),
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_collection_check" CHECK ("drafts"."collection" in ('news', 'wiki')),
	CONSTRAINT "drafts_status_check" CHECK ("drafts"."status" = 'draft'),
	CONSTRAINT "drafts_version_check" CHECK ("drafts"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "draft_authors" ADD CONSTRAINT "draft_authors_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_authors" ADD CONSTRAINT "draft_authors_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_authors_position_unique" ON "draft_authors" USING btree ("draft_id","position");--> statement-breakpoint
CREATE INDEX "draft_authors_member_id_index" ON "draft_authors" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_article_owner_unique" ON "drafts" USING btree ("article_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "drafts_owner_user_id_index" ON "drafts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "drafts_article_id_index" ON "drafts" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "drafts_updated_at_index" ON "drafts" USING btree ("updated_at");