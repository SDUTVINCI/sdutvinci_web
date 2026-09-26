DROP INDEX "users_account_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_active_account_unique" ON "users" USING btree ("account") WHERE "users"."deleted_at" is null;