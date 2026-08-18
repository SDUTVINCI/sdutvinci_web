ALTER TABLE "content_pr_external_actions" DROP CONSTRAINT "content_pr_external_actions_action_check";--> statement-breakpoint
ALTER TABLE "content_pr_import_runs" ADD COLUMN "head_repository_id" varchar(200);--> statement-breakpoint
ALTER TABLE "content_pr_import_runs" ADD COLUMN "head_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "content_pr_external_actions" ADD CONSTRAINT "content_pr_external_actions_action_check" CHECK ("content_pr_external_actions"."action" in ('comment', 'close', 'delete_branch'));