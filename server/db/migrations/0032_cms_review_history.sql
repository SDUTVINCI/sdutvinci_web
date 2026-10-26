CREATE TABLE "cms_review_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"title" text NOT NULL,
	"action" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"submitter_label" text NOT NULL,
	"note" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"batch_id" uuid,
	"legacy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_review_history_kind_check" CHECK ("cms_review_history"."kind" in ('article', 'member_application', 'member_profile', 'account_registration')),
	CONSTRAINT "cms_review_history_action_check" CHECK ("cms_review_history"."action" in ('approved', 'rejected', 'published', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "cms_review_history" ADD CONSTRAINT "cms_review_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cms_review_history_source_unique" ON "cms_review_history" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "cms_review_history_time_index" ON "cms_review_history" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "cms_review_history_kind_time_index" ON "cms_review_history" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "cms_review_history_actor_time_index" ON "cms_review_history" USING btree ("actor_user_id","created_at");
--> statement-breakpoint
-- The migration only copies facts that already exist. Old content/identity
-- snapshots were not retained, so these rows explicitly remain legacy records.
CREATE OR REPLACE FUNCTION pg_temp.cms_history_label(actor uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT coalesce(m.name, u.account) || '（@' || u.account || '）'
    FROM users u LEFT JOIN user_members um ON um.user_id = u.id
    LEFT JOIN members m ON m.id = um.member_id WHERE u.id = actor LIMIT 1), '历史记录未保存')
$$;
--> statement-breakpoint
INSERT INTO cms_review_history(source_key, kind, target_id, title, action, actor_user_id, actor_label, submitter_label, note, legacy, created_at)
SELECT 'article-review:' || e.id, 'article', d.id, d.title, e.action, e.actor_user_id,
  pg_temp.cms_history_label(e.actor_user_id), pg_temp.cms_history_label(d.owner_user_id), e.reason, true, e.created_at
FROM review_events e JOIN drafts d ON d.id = e.draft_id
WHERE e.action IN ('approved', 'rejected') ON CONFLICT(source_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO cms_review_history(source_key, kind, target_id, title, action, actor_user_id, actor_label, submitter_label, note, legacy, created_at)
SELECT 'article-publication:' || a.id, 'article', d.id, d.title, 'published', a.actor_user_id,
  pg_temp.cms_history_label(a.actor_user_id), pg_temp.cms_history_label(d.owner_user_id), null, true, a.created_at
FROM audit_logs a JOIN drafts d ON d.id::text = a.metadata->>'draftId'
WHERE a.action IN ('article.publish', 'article.delete_proposal.publish') ON CONFLICT(source_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO cms_review_history(source_key, kind, target_id, title, action, actor_user_id, actor_label, submitter_label, note, legacy, created_at)
SELECT 'member-application:' || id || ':' || CASE status WHEN 'approved' THEN 'approve' ELSE 'reject' END,
  'member_application', id, coalesce(profile->>'name', '新成员申请'), status, reviewed_by_user_id,
  pg_temp.cms_history_label(reviewed_by_user_id), '匿名申请', review_note, true, coalesce(reviewed_at, updated_at)
FROM member_applications WHERE status IN ('approved', 'rejected') ON CONFLICT(source_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO cms_review_history(source_key, kind, target_id, title, action, actor_user_id, actor_label, submitter_label, note, legacy, created_at)
SELECT 'member-proposal:' || p.id || ':' || CASE p.status WHEN 'applied' THEN 'approve' ELSE 'reject' END,
  'member_profile', p.id, coalesce(p.proposed_profile->>'name', m.name, '成员资料'),
  CASE p.status WHEN 'applied' THEN 'approved' ELSE 'rejected' END, p.applied_by_user_id,
  pg_temp.cms_history_label(p.applied_by_user_id), pg_temp.cms_history_label(p.created_by_user_id),
  p.review_note, true, coalesce(p.resolved_at, p.created_at)
FROM member_proposals p JOIN members m ON m.id = p.member_id WHERE p.status IN ('applied', 'rejected')
ON CONFLICT(source_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO cms_review_history(source_key, kind, target_id, title, action, actor_user_id, actor_label, submitter_label, note, legacy, created_at)
SELECT 'account-registration:' || a.id || ':' || CASE a.status WHEN 'approved' THEN 'approve' ELSE 'reject' END,
  'account_registration', a.id, m.name || ' · @' || a.account, a.status, a.reviewed_by_user_id,
  pg_temp.cms_history_label(a.reviewed_by_user_id), m.name, a.review_note, true, coalesce(a.reviewed_at, a.updated_at)
FROM account_registration_applications a JOIN members m ON m.id = a.member_id
WHERE a.status IN ('approved', 'rejected') ON CONFLICT(source_key) DO NOTHING;
