ALTER TABLE "articles" ADD COLUMN "requires_auth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "articles_requires_auth_index" ON "articles" USING btree ("requires_auth");