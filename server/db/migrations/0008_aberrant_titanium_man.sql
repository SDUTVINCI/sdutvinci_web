CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"uploader_user_id" uuid,
	"object_key" text NOT NULL,
	"public_url" text NOT NULL,
	"original_filename" text NOT NULL,
	"original_mime_type" varchar(100) NOT NULL,
	"original_byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_original_byte_size_check" CHECK ("media_assets"."original_byte_size" > 0),
	CONSTRAINT "media_assets_width_check" CHECK ("media_assets"."width" > 0),
	CONSTRAINT "media_assets_height_check" CHECK ("media_assets"."height" > 0),
	CONSTRAINT "media_assets_byte_size_check" CHECK ("media_assets"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_object_key_unique" ON "media_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "media_assets_draft_id_index" ON "media_assets" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "media_assets_uploader_user_id_index" ON "media_assets" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE INDEX "media_assets_created_at_index" ON "media_assets" USING btree ("created_at");