import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  CmsDraftConflictError,
  CmsDraftNotFoundError,
  createCmsDraftForArticle,
  createCmsNewArticleDraft,
  deleteCmsDraft,
  getCmsDraft,
  listCmsDrafts,
  restoreCmsDraft,
  saveCmsDraft
} from '../server/services/cms-drafts'
import { bootstrapCmsAdmin, createCmsUser } from '../server/services/cms-auth'
import { listCmsArticles, synchronizeCmsArticles } from '../server/services/cms-articles'
import { synchronizeCmsMembers } from '../server/services/cms-members'
import { cmsDraftSaveSchema } from '../server/utils/cms-draft-validation'
import { acquireCmsDraftEditLock } from '../server/services/cms-edit-locks'
import { getCmsDashboardStats } from '../server/services/cms-dashboard'
import {
  assessMarkdownVisualSafety,
  normalizeMarkdownRoundTrip
} from '../shared/utils/cms-markdown-safety'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
let contentRoot = ''
let userId = ''

const acquireLease = async (draftId: string) => {
  const result = await acquireCmsDraftEditLock(draftId, userId, true)
  return result.lock.leaseId!
}

const markdown = (frontmatter: string, body = '') =>
  `---\n${frontmatter.trim()}\n---\n${body}`

integration('CMS Markdown 编辑器与草稿系统', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    contentRoot = await mkdtemp(join(tmpdir(), 'vinci-cms-drafts-'))
    process.env.CMS_CONTENT_ROOT = contentRoot
    await Promise.all(['members', 'news', 'wiki'].map(path =>
      mkdir(join(contentRoot, path), { recursive: true })
    ))
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table rate_limit_buckets, content_export_jobs, content_export_runs, article_deletion_events, publish_records, edit_locks, review_events, audit_logs, sessions, draft_authors, article_revisions, drafts, user_members, user_roles, articles, members, users
      restart identity cascade
    `)
    await Promise.all(['members', 'news', 'wiki'].map(async (path) => {
      await rm(join(contentRoot, path), { recursive: true, force: true })
      await mkdir(join(contentRoot, path), { recursive: true })
    }))
    await writeFile(
      join(contentRoot, 'members', '董佳辉.md'),
      markdown('name: 董佳辉\nid: dongjiahui\nimage: /avatar.jpg')
    )
    const user = await bootstrapCmsAdmin({
      account: 'dongjiahui',
      password: 'AdminPassword123'
    })
    userId = user!.id
    await synchronizeCmsMembers(false)
  })

  afterAll(async () => {
    await closeDatabase()
    if (contentRoot.startsWith(tmpdir())) {
      await rm(contentRoot, { recursive: true, force: true })
    }
  })

  it('新文章草稿只写 PostgreSQL，自动加入当前成员并可重新打开恢复', async () => {
    const contentBefore = await readFile(join(contentRoot, 'members', '董佳辉.md'), 'utf8')
    const draft = await createCmsNewArticleDraft('news', '新文章', userId)
    expect(draft).toMatchObject({
      articleId: null,
      title: '新文章',
      baseContentHash: null,
      version: 1
    })
    expect(draft.authors.map(author => author.memberKey)).toEqual(['dongjiahui'])

    const body = '# 标题\n\n- [x] 任务\n\n| A | B |\n| - | - |\n| 1 | 2 |\n'
    const lockLeaseId = await acquireLease(draft.id)
    const saved = await saveCmsDraft(draft.id, userId, {
      title: '已自动保存',
      description: '摘要',
      body,
      authorKeys: ['dongjiahui'],
      version: draft.version,
      lockLeaseId
    })
    expect(saved.version).toBe(2)
    expect((await getCmsDraft(draft.id, userId))?.body).toBe(body)
    expect((await listCmsDrafts(userId))[0]?.title).toBe('已自动保存')
    expect(await readFile(join(contentRoot, 'members', '董佳辉.md'), 'utf8')).toBe(contentBefore)
    expect(await listCmsArticles()).toMatchObject({ total: 0 })
  })

  it('已有文章草稿记录正式内容哈希，保存草稿不改变源 Markdown', async () => {
    const articlePath = join(contentRoot, 'news', 'published.md')
    const source = markdown(
      'title: 正式文章\ndescription: 正式摘要\ncontributors:\n  - system\nupdatedAt: 2026-01-01\npublishedAt: 2025-01-01',
      '正式正文\n'
    )
    await writeFile(articlePath, source)
    await synchronizeCmsArticles()
    const article = (await listCmsArticles()).articles[0]!
    const draft = await createCmsDraftForArticle(article.id, userId)

    expect(draft.baseContentHash).toBe(article.contentHash)
    expect(draft.systemFrontmatter).toEqual({
      contributors: ['system'],
      updatedAt: '2026-01-01',
      publishedAt: '2025-01-01'
    })
    const lockLeaseId = await acquireLease(draft.id)
    await saveCmsDraft(draft.id, userId, {
      title: '草稿标题',
      description: '草稿摘要',
      body: '草稿正文',
      authorKeys: ['dongjiahui'],
      version: draft.version,
      lockLeaseId
    })
    expect(await readFile(articlePath, 'utf8')).toBe(source)
    expect((await listCmsArticles()).articles[0]).toMatchObject({
      title: '正式文章',
      contentHash: article.contentHash
    })
  })

  it('使用乐观版本号阻止旧页面覆盖较新的自动保存', async () => {
    const draft = await createCmsNewArticleDraft('wiki', '并发测试', userId)
    const lockLeaseId = await acquireLease(draft.id)
    await saveCmsDraft(draft.id, userId, {
      title: draft.title,
      description: '',
      body: '较新内容',
      authorKeys: ['dongjiahui'],
      version: 1,
      lockLeaseId
    })
    await expect(saveCmsDraft(draft.id, userId, {
      title: draft.title,
      description: '',
      body: '旧页面内容',
      authorKeys: ['dongjiahui'],
      version: 1,
      lockLeaseId
    })).rejects.toBeInstanceOf(CmsDraftConflictError)
    expect((await getCmsDraft(draft.id, userId))?.body).toBe('较新内容')
  })

  it('草稿只能由创建者读取和保存', async () => {
    const draft = await createCmsNewArticleDraft('news', '私有草稿', userId)
    const other = await createCmsUser({
      account: 'otheruser',
      password: 'OtherPassword123',
      roles: ['member']
    }, userId)
    expect(await getCmsDraft(draft.id, other!.id)).toBeNull()
    await expect(saveCmsDraft(draft.id, other!.id, {
      title: '越权修改',
      description: '',
      body: '越权正文',
      authorKeys: [],
      version: 1,
      lockLeaseId: randomUUID()
    })).rejects.toBeInstanceOf(CmsDraftNotFoundError)
  })

  it('草稿由本人软删除后可恢复，并记录审计', async () => {
    const draft = await createCmsNewArticleDraft('news', '可删除草稿', userId)
    expect(await getCmsDashboardStats(userId, false)).toMatchObject({
      drafts: { total: 1, scope: 'mine' },
      members: 1
    })
    const deleted = await deleteCmsDraft(draft.id, userId)
    expect(deleted.id).toBe(draft.id)
    expect(await getCmsDraft(draft.id, userId)).toBeNull()
    expect(await listCmsDrafts(userId)).toHaveLength(0)
    expect(await listCmsDrafts(userId, { deleted: true })).toMatchObject([
      { id: draft.id, isDeleted: true }
    ])
    const restored = await restoreCmsDraft(draft.id, userId)
    expect(restored).toMatchObject({ id: draft.id, isDeleted: false })
    expect(await getCmsDraft(draft.id, userId)).toMatchObject({ id: draft.id })
    const audits = await getDatabase().execute(sql`
      select action from audit_logs where target_id = ${draft.id}
    `)
    expect(audits.rows.map((row: any) => row.action)).toEqual(
      expect.arrayContaining(['draft.delete', 'draft.restore'])
    )
  })

  it('严格拒绝伪造系统 Frontmatter 字段', () => {
    const base = {
      title: '标题',
      description: '',
      body: '正文',
      authorKeys: ['dongjiahui'],
      version: 1,
      lockLeaseId: randomUUID()
    }
    for (const field of ['contributors', 'updatedAt', 'publishedAt']) {
      expect(cmsDraftSaveSchema.safeParse({ ...base, [field]: 'forged' }).success).toBe(false)
    }
  })

  it('支持标准 Markdown 元素，并阻止扩展语法进入可视化模式', () => {
    const supported = [
      '# 标题', '普通文本 **粗体** *斜体* ~~删除线~~ `代码`', '> 引用',
      '1. 有序', '- 无序', '- [x] 任务', '[链接](https://example.com)',
      '![图片](https://example.com/image.png)', '| A | B |', '| - | - |',
      '| 1 | 2 |', '```ts', 'const ok = true', '```', '---'
    ].join('\n\n')
    expect(assessMarkdownVisualSafety(supported)).toEqual({ allowed: true, reasons: [] })
    expect(normalizeMarkdownRoundTrip(`${supported}\n`)).toBe(
      normalizeMarkdownRoundTrip(supported)
    )
    expect(assessMarkdownVisualSafety('<NuxtLink to="/">首页</NuxtLink>')).toMatchObject({
      allowed: true
    })
    expect(assessMarkdownVisualSafety('{% include section.html %}')).toMatchObject({
      allowed: true
    })
  })
})
