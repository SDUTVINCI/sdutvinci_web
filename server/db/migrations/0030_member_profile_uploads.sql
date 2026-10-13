CREATE TABLE "member_profile_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"url" text NOT NULL,
	"proposal_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_proposals" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "member_profile_uploads" ADD CONSTRAINT "member_profile_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile_uploads" ADD CONSTRAINT "member_profile_uploads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_profile_uploads" ADD CONSTRAINT "member_profile_uploads_proposal_id_member_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."member_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_profile_uploads_expiry_index" ON "member_profile_uploads" USING btree ("expires_at");