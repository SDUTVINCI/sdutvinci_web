DROP INDEX "members_member_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "members_active_member_key_unique" ON "members" USING btree ("member_key") WHERE "members"."deleted_at" is null;