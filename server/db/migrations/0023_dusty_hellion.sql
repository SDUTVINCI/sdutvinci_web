CREATE TABLE "account_registration_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"account" varchar(32) NOT NULL,
	"password_hash" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"review_note" text,
	"approved_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_registration_applications_account_format_check" CHECK ("account_registration_applications"."account" ~ '^[a-z][a-z0-9]{2,31}$'),
	CONSTRAINT "account_registration_applications_status_check" CHECK ("account_registration_applications"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "account_registration_applications_password_state_check" CHECK (("account_registration_applications"."status" = 'pending' and "account_registration_applications"."password_hash" is not null) or ("account_registration_applications"."status" in ('approved', 'rejected') and "account_registration_applications"."password_hash" is null))
);
--> statement-breakpoint
ALTER TABLE "account_registration_applications" ADD CONSTRAINT "account_registration_applications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_registration_applications" ADD CONSTRAINT "account_registration_applications_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_registration_applications" ADD CONSTRAINT "account_registration_applications_approved_user_id_users_id_fk" FOREIGN KEY ("approved_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_registration_applications_pending_member_unique" ON "account_registration_applications" USING btree ("member_id") WHERE "account_registration_applications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "account_registration_applications_pending_account_unique" ON "account_registration_applications" USING btree ("account") WHERE "account_registration_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "account_registration_applications_status_created_index" ON "account_registration_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "account_registration_applications_member_index" ON "account_registration_applications" USING btree ("member_id");
