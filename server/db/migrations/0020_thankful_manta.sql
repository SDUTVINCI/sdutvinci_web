ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
CREATE INDEX "users_deleted_at_index" ON "users" USING btree ("deleted_at");
--> statement-breakpoint
DELETE FROM "user_roles" WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'content_importer');
--> statement-breakpoint
DELETE FROM "roles" WHERE "code" = 'content_importer';
