CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection" varchar(32) NOT NULL,
	"relative_path" text NOT NULL,
	"public_path" text NOT NULL,
	"directory" text NOT NULL,
	"title" text NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"is_present" varchar(5) DEFAULT 'true' NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_collection_check" CHECK ("articles"."collection" in ('news', 'wiki')),
	CONSTRAINT "articles_is_present_check" CHECK ("articles"."is_present" in ('true', 'false'))
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_source_unique" ON "articles" USING btree ("collection","relative_path");--> statement-breakpoint
CREATE INDEX "articles_collection_index" ON "articles" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "articles_directory_index" ON "articles" USING btree ("directory");--> statement-breakpoint
CREATE INDEX "articles_present_index" ON "articles" USING btree ("is_present");