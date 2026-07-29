ALTER TABLE "article_revisions" ADD COLUMN "source_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "git_commit_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_source_operation_id_publish_records_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "public"."publish_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_source_operation_unique" ON "article_revisions" USING btree ("source_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_revisions_article_git_commit_unique" ON "article_revisions" USING btree ("article_id","git_commit_hash");