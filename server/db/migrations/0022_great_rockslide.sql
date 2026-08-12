CREATE TABLE "article_credit_identities" (
	"credit_key" varchar(32) PRIMARY KEY NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"member_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_credit_identities_key_format_check" CHECK ("article_credit_identities"."credit_key" ~ '^[a-z][a-z0-9]{2,31}$'),
	CONSTRAINT "article_credit_identities_display_name_check" CHECK (length(btrim("article_credit_identities"."display_name")) between 1 and 100),
	CONSTRAINT "article_credit_identities_version_check" CHECK ("article_credit_identities"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "article_credit_identities" ADD CONSTRAINT "article_credit_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_credit_identities_member_id_index" ON "article_credit_identities" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "article_credit_identities_display_name_index" ON "article_credit_identities" USING btree ("display_name");--> statement-breakpoint
INSERT INTO "article_credit_identities" ("credit_key", "display_name", "member_id")
SELECT seed."credit_key", seed."display_name", member."id"
FROM (VALUES
	('caohaozheng', '曹浩正'),
	('cuitonghui', '崔桐汇'),
	('cuizongchuang', '崔宗闯'),
	('jingjiale', '荆家乐'),
	('liao', '李澳'),
	('liujiaqi', '刘家祺'),
	('liuhaolin', '刘浩林'),
	('liumingyang', '刘铭洋'),
	('maojingqiu', '毛婧秋'),
	('qijunlong', '祁俊龙'),
	('sunjianghui', '孙江辉'),
	('wangjing', '王静'),
	('wangkailu', '王凯璐'),
	('wangxiaohan', '王小涵'),
	('yanghaoran', '杨浩冉'),
	('yaoshangnan', '姚尚男'),
	('zhaoyouqi', '赵宥淇'),
	('zhouxiaolong', '周晓龙')
) AS seed("credit_key", "display_name")
LEFT JOIN "members" AS member
	ON member."member_key" = seed."credit_key"
	AND member."deleted_at" IS NULL
WHERE EXISTS (
	SELECT 1
	FROM "articles" AS article
	JOIN "article_revisions" AS revision ON revision."id" = article."current_revision_id"
	WHERE article."collection" = 'wiki'
		AND article."is_present" = 'true'
		AND article."deleted_at" IS NULL
		AND (
			COALESCE(revision."frontmatter"->'authors', '[]'::jsonb) ? seed."credit_key"
			OR COALESCE(revision."frontmatter"->'contributors', '[]'::jsonb) ? seed."credit_key"
			OR COALESCE(revision."frontmatter"->'authors', '[]'::jsonb) ? seed."display_name"
			OR COALESCE(revision."frontmatter"->'contributors', '[]'::jsonb) ? seed."display_name"
		)
);
