import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { articleRevisions, articles } from '../server/db/schema'
import { synchronizeCmsArticles } from '../server/services/cms-articles'
import {
  applyArticleRevisionBackfill,
  ArticleRevisionBackfillValidationError,
  dryRunArticleRevisionBackfill
} from '../server/services/v2-article-revision-backfill'
import { parseCmsMarkdown } from '../server/utils/cms-frontmatter'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
const migrationsRoot = resolve(process.cwd(), 'server/db/migrations')
let contentRoot = ''

const markdown = (frontmatter: string, body = '') =>
  `---\n${frontmatter.trim()}\n---\n${body}`

const sha256 = (source: string) =>
  createHash('sha256').update(source).digest('hex')

const resetContent = async () => {
  process.env.CMS_CONTENT_ROOT = contentRoot
  for (const area of ['members', 'news', 'wiki']) {
    await rm(join(contentRoot, area), { recursive: true, force: true })
    await mkdir(join(contentRoot, area), { recursive: true })
  }
}

const writeArticle = async (
  collection: 'news' | 'wiki',
  relativePath: string,
  source: string
) => {
  const target = join(contentRoot, collection, relativePath)
  await mkdir(resolve(target, '..'), { recursive: true })
  await writeFile(target, source)
  return target
}

const applyMigrationSql = async (client: Client, path: string) => {
  const source = await readFile(path, 'utf8')
  for (const statement of source
    .split('--> statement-breakpoint')
    .map(value => value.trim())
    .filter(Boolean)) {
    await client.query(statement)
  }
}

const withTemporaryDatabase = async (
  run: (client: Client, databaseName: string) => Promise<void>
) => {
  const sourceUrl = new URL(process.env.DATABASE_URL!)
  const databaseName = `vinci_phase1_${randomUUID().replaceAll('-', '')}_test`
  const admin = new Client({ connectionString: sourceUrl.toString() })
  await admin.connect()
  await admin.query(`create database "${databaseName}"`)
  const targetUrl = new URL(sourceUrl)
  targetUrl.pathname = `/${databaseName}`
  const client = new Client({ connectionString: targetUrl.toString() })
  await client.connect()
  try {
    await run(client, databaseName)
  } finally {
    await client.end()
    await admin.query(`drop database "${databaseName}" with (force)`)
    await admin.end()
  }
}

integration('V2 阶段 1 Migration 与正式 Revision 安全回填', () => {
  beforeAll(async () => {
    contentRoot = await mkdtemp(join(tmpdir(), 'vinci-v2-phase1-content-'))
    await resetContent()
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table rate_limit_buckets, media_assets, content_export_jobs, content_export_runs, article_deletion_events,
        publish_records, edit_locks, review_events, audit_logs, sessions,
        draft_authors, article_revisions, drafts, user_members, user_roles,
        articles, members, users
      restart identity cascade
    `)
    await resetContent()
  })

  afterAll(async () => {
    await closeDatabase()
    if (contentRoot.startsWith(tmpdir())) {
      await rm(contentRoot, { recursive: true, force: true })
    }
  })

  it('可在空数据库重放全部 Migration', async () => {
    await withTemporaryDatabase(async (client) => {
      const migrations = (await readdir(migrationsRoot))
        .filter(name => /^\d{4}_.+\.sql$/.test(name))
        .sort()
      for (const migration of migrations) {
        await applyMigrationSql(client, join(migrationsRoot, migration))
      }
      const result = await client.query(`
        select
          to_regclass('public.article_revisions')::text as revision_table,
          exists (
            select 1 from information_schema.columns
            where table_name = 'articles' and column_name = 'current_revision_id'
          ) as has_current_revision,
          exists (
            select 1 from information_schema.columns
            where table_name = 'drafts' and column_name = 'base_revision_id'
          ) as has_base_revision
      `)
      expect(result.rows[0]).toEqual({
        revision_table: 'article_revisions',
        has_current_revision: true,
        has_base_revision: true
      })
    })
  })

  it('业务服务不提供 Revision 正文更新或删除路径', async () => {
    const servicesRoot = resolve(process.cwd(), 'server/services')
    const serviceFiles = (await readdir(servicesRoot, { recursive: true }))
      .filter(path => path.endsWith('.ts'))
    const offenders: string[] = []
    for (const path of serviceFiles) {
      const source = await readFile(join(servicesRoot, path), 'utf8')
      if (
        /\.update\s*\(\s*articleRevisions\s*\)/.test(source)
        || /\.delete\s*\(\s*articleRevisions\s*\)/.test(source)
      ) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('可在含 V1 文章和草稿的数据库执行 expand Migration 且不改旧数据', async () => {
    await withTemporaryDatabase(async (client) => {
      const migrations = (await readdir(migrationsRoot))
        .filter(name => /^\d{4}_.+\.sql$/.test(name))
        .sort()
      const phase1MigrationIndex = migrations.findIndex(
        migration => migration.startsWith('0011_')
      )
      expect(phase1MigrationIndex).toBeGreaterThanOrEqual(0)
      const phase1Migration = migrations[phase1MigrationIndex]!
      for (const migration of migrations.slice(0, phase1MigrationIndex)) {
        await applyMigrationSql(client, join(migrationsRoot, migration))
      }
      const user = await client.query(`
        insert into users (account, password_hash)
        values ('phaseone', 'test-only')
        returning id
      `)
      const article = await client.query(`
        insert into articles (
          collection, relative_path, public_path, directory, title,
          frontmatter, search_text, content_hash
        )
        values (
          'wiki', 'legacy.md', '/wiki/legacy', 'wiki', 'Legacy',
          '{"title":"Legacy"}', 'legacy', repeat('a', 64)
        )
        returning id
      `)
      const draft = await client.query(`
        insert into drafts (article_id, owner_user_id, collection, title, body)
        values ($1, $2, 'wiki', 'Legacy draft', 'body')
        returning id
      `, [article.rows[0].id, user.rows[0].id])

      await applyMigrationSql(client, join(migrationsRoot, phase1Migration))
      const preserved = await client.query(`
        select
          a.id as article_id,
          a.current_revision_id,
          d.id as draft_id,
          d.base_revision_id,
          d.base_content_hash
        from articles a
        join drafts d on d.article_id = a.id
      `)
      expect(preserved.rows).toEqual([{
        article_id: article.rows[0].id,
        current_revision_id: null,
        draft_id: draft.rows[0].id,
        base_revision_id: null,
        base_content_hash: null
      }])
      expect((await client.query('select count(*)::int as count from article_revisions')).rows[0])
        .toEqual({ count: 0 })
    })
  })

  it('Dry Run 只读并报告稳定 vinciId、路径和预期动作', async () => {
    await writeArticle(
      'news',
      'hello.md',
      markdown('title: 新闻\nunknownField: keep-me', '新闻正文')
    )
    await writeArticle(
      'wiki',
      'guide/index.md',
      markdown('title: Wiki\ncustom:\n  nested: true', '<NuxtLink to="/">首页</NuxtLink>')
    )
    await synchronizeCmsArticles()
    const beforeRows = await getDatabase()
      .select({ id: articles.id, currentRevisionId: articles.currentRevisionId })
      .from(articles)
    const report = await dryRunArticleRevisionBackfill()

    expect(report.summary).toMatchObject({
      scannedMarkdownFiles: 2,
      indexedArticles: 2,
      activeArticles: 2,
      createRevisions: 2,
      blockers: 0,
      createdRevisions: 0,
      linkedArticles: 0
    })
    expect(report.items.every(item =>
      item.vinciId === item.articleId && item.action === 'create_revision'
    )).toBe(true)
    expect(await getDatabase().select().from(articleRevisions)).toHaveLength(0)
    expect(await getDatabase()
      .select({ id: articles.id, currentRevisionId: articles.currentRevisionId })
      .from(articles)).toEqual(beforeRows)
  })

  it('在一个事务中保存完整原文、正文、Frontmatter、哈希并幂等设置当前指针', async () => {
    const newsSource = markdown(
      'title: 新闻\nunknownField: keep-me\ntags:\n  - robot',
      '正文\n\n{% include teacher.html %}'
    )
    const wikiSource = markdown(
      'title: Wiki\ncustom:\n  nested: true',
      '<NuxtLink to="/wiki">Wiki</NuxtLink>'
    )
    await writeArticle('news', 'hello.md', newsSource)
    await writeArticle('wiki', 'guide/index.md', wikiSource)
    await synchronizeCmsArticles()
    const originalUpdatedAt = new Map(
      (await getDatabase().select().from(articles))
        .map(article => [article.id, article.updatedAt.toISOString()])
    )

    const first = await applyArticleRevisionBackfill()
    expect(first.summary).toMatchObject({
      blockers: 0,
      createdRevisions: 2,
      linkedArticles: 2,
      alreadyBackfilled: 2
    })
    const revisions = await getDatabase()
      .select()
      .from(articleRevisions)
      .orderBy(articleRevisions.articleId)
    expect(revisions).toHaveLength(2)
    for (const revision of revisions) {
      const article = (await getDatabase()
        .select()
        .from(articles)
        .where(eq(articles.id, revision.articleId))
        .limit(1))[0]!
      const source = article.collection === 'news' ? newsSource : wikiSource
      const parsed = parseCmsMarkdown(source)
      expect(revision).toMatchObject({
        revisionNumber: 1,
        markdownSource: source,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        contentHash: sha256(source),
        sourceKind: 'backfill'
      })
      expect(article.currentRevisionId).toBe(revision.id)
      expect(article.updatedAt.toISOString()).toBe(originalUpdatedAt.get(article.id))
    }

    const second = await applyArticleRevisionBackfill()
    expect(second.summary).toMatchObject({
      blockers: 0,
      createdRevisions: 0,
      linkedArticles: 0,
      alreadyBackfilled: 2
    })
    expect(await getDatabase().select().from(articleRevisions)).toHaveLength(2)
  })

  it('对删除、缺失、索引哈希漂移和未建索引文件给出明确策略并拒绝写入', async () => {
    const activePath = await writeArticle(
      'wiki',
      'active.md',
      markdown('title: Active', 'active')
    )
    await writeArticle('news', 'deleted.md', markdown('title: Deleted', 'deleted'))
    await synchronizeCmsArticles()
    const rows = await getDatabase().select().from(articles)
    const deleted = rows.find(row => row.collection === 'news')!
    await getDatabase().update(articles).set({
      deletedAt: new Date(),
      isPresent: 'false'
    }).where(eq(articles.id, deleted.id))
    await unlink(join(contentRoot, 'news', 'deleted.md'))
    await unlink(activePath)
    await writeArticle('wiki', 'unindexed.md', markdown('title: Extra', 'extra'))

    const report = await dryRunArticleRevisionBackfill()
    expect(report.items.find(item => item.articleId === deleted.id)?.action)
      .toBe('skip_deleted')
    expect(report.issues.map(issue => issue.code).sort()).toEqual([
      'active_article_missing_file',
      'unindexed_file'
    ])
    await expect(applyArticleRevisionBackfill()).rejects
      .toBeInstanceOf(ArticleRevisionBackfillValidationError)
    expect(await getDatabase().select().from(articleRevisions)).toHaveLength(0)
    expect(await getDatabase().select().from(articles).where(
      and(isNull(articles.currentRevisionId), eq(articles.isPresent, 'true'))
    )).toHaveLength(1)
  })

  it('可接续完全一致的既有首个 Revision，但拒绝冲突内容', async () => {
    const source = markdown('title: Existing', 'body')
    await writeArticle('wiki', 'existing.md', source)
    await synchronizeCmsArticles()
    const [article] = await getDatabase().select().from(articles)
    const parsed = parseCmsMarkdown(source)
    const [revision] = await getDatabase().insert(articleRevisions).values({
      articleId: article!.id,
      revisionNumber: 1,
      markdownSource: source,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(source),
      sourceKind: 'backfill'
    }).returning()

    const linked = await applyArticleRevisionBackfill()
    expect(linked.summary).toMatchObject({
      createdRevisions: 0,
      linkedArticles: 1,
      alreadyBackfilled: 1
    })
    expect((await getDatabase().select().from(articles))[0]?.currentRevisionId)
      .toBe(revision!.id)

    await getDatabase().update(articles).set({ currentRevisionId: null })
      .where(eq(articles.id, article!.id))
    await getDatabase().delete(articleRevisions).where(eq(articleRevisions.id, revision!.id))
    await getDatabase().insert(articleRevisions).values({
      articleId: article!.id,
      revisionNumber: 1,
      markdownSource: 'conflict',
      body: 'conflict',
      frontmatter: {},
      contentHash: sha256('conflict'),
      sourceKind: 'backfill'
    })
    const conflict = await dryRunArticleRevisionBackfill()
    expect(conflict.issues[0]?.code).toBe('existing_revision_conflict')
  })

  it('数据库事务中途失败时不留下半回填 Revision 或指针', async () => {
    await writeArticle('wiki', 'a.md', markdown('title: A', 'A'))
    await writeArticle('wiki', 'b.md', markdown('title: B', 'B'))
    await synchronizeCmsArticles()
    await getDatabase().execute(sql`
      create function v2_phase1_fail_second_revision()
      returns trigger language plpgsql as $$
      begin
        if (select count(*) from article_revisions) >= 1 then
          raise exception 'phase1 forced rollback';
        end if;
        return new;
      end
      $$
    `)
    await getDatabase().execute(sql`
      create trigger v2_phase1_fail_second_revision_trigger
      before insert on article_revisions
      for each row execute function v2_phase1_fail_second_revision()
    `)
    try {
      await expect(applyArticleRevisionBackfill()).rejects
        .toBeInstanceOf(Error)
    } finally {
      await getDatabase().execute(sql`
        drop trigger if exists v2_phase1_fail_second_revision_trigger
          on article_revisions
      `)
      await getDatabase().execute(sql`
        drop function if exists v2_phase1_fail_second_revision()
      `)
    }
    expect(await getDatabase().select().from(articleRevisions)).toHaveLength(0)
    expect(await getDatabase().select().from(articles)
      .where(isNull(articles.currentRevisionId))).toHaveLength(2)
  })

  it('可对仓库全部 228 篇正式文章回填并逐篇核对 SHA-256', async () => {
    process.env.CMS_CONTENT_ROOT = resolve(process.cwd(), 'content')
    expect(await synchronizeCmsArticles()).toBe(228)
    const dryRun = await dryRunArticleRevisionBackfill()
    expect(dryRun.summary).toMatchObject({
      scannedMarkdownFiles: 228,
      activeArticles: 228,
      createRevisions: 228,
      blockers: 0
    })

    const applied = await applyArticleRevisionBackfill()
    expect(applied.summary).toMatchObject({
      createdRevisions: 228,
      linkedArticles: 228,
      alreadyBackfilled: 228,
      blockers: 0
    })
    const revisionRows = await getDatabase().select().from(articleRevisions)
    expect(revisionRows).toHaveLength(228)
    for (const revision of revisionRows) {
      expect(revision.contentHash).toBe(sha256(revision.markdownSource))
    }
  })
})
