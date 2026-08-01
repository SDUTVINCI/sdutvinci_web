import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { articles } from '../server/db/schema'
import {
  getCmsArticle,
  listCmsArticles,
  synchronizeCmsArticles
} from '../server/services/cms-articles'
import {
  createCmsMember,
  listCmsMembers,
  synchronizeCmsMembers,
  updateCmsMember
} from '../server/services/cms-members'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import { allocateMemberKey, memberKeyFromName } from '../server/utils/member-key'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
let contentRoot = ''

const markdown = (frontmatter: string, body = '') =>
  `---\n${frontmatter.trim()}\n---\n${body}`

integration('CMS 成员与文章只读管理', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    contentRoot = await mkdtemp(join(tmpdir(), 'vinci-cms-content-'))
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
  })

  afterAll(async () => {
    await closeDatabase()
    if (contentRoot.startsWith(tmpdir())) {
      await rm(contentRoot, { recursive: true, force: true })
    }
  })

  it('按拼音生成稳定 ID，并为重名依次追加数字', () => {
    const used = new Set<string>()
    const base = memberKeyFromName('董佳辉')
    expect([
      allocateMemberKey(base, used),
      allocateMemberKey(base, used),
      allocateMemberKey(base, used)
    ]).toEqual(['dongjiahui', 'dongjiahui1', 'dongjiahui2'])
  })

  it('一次性导入已有稳定 ID，之后 Markdown 变化不再覆盖数据库权威资料', async () => {
    await mkdir(join(contentRoot, 'members', '2026'))
    for (const [file, name, id] of [['a.md', '董佳辉', 'dongjiahui'], ['b.md', '董佳辉', 'dongjiahui1'], ['c.md', '董佳辉', 'dongjiahui2']]) {
      await writeFile(
        join(contentRoot, 'members', '2026', file),
        markdown(`id: ${id}\nname: ${name}\nimage: /avatar.jpg`)
      )
    }

    expect(await synchronizeCmsMembers()).toBe(3)
    const firstPass = await listCmsMembers()
    expect(firstPass.map(member => member.memberKey)).toEqual([
      'dongjiahui',
      'dongjiahui1',
      'dongjiahui2'
    ])

    const first = firstPass[0]!
    const memberPath = join(contentRoot, 'members', first.sourcePath)
    const original = await readFile(memberPath, 'utf8')
    await writeFile(memberPath, original.replace('name: 董佳辉', 'name: 新姓名'))
    await synchronizeCmsMembers()
    const source = await readFile(memberPath, 'utf8')
    expect(source).toContain(`id: ${first.memberKey}`)
    expect((await listCmsMembers()).find(member => member.id === first.id)?.name).toBe('董佳辉')
  })

  it('管理员能创建和维护成员，且同 ID 账号自动绑定', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'dongjiahui',
      password: 'AdminPassword123'
    })
    const created = await createCmsMember({
      memberKey: 'dongjiahui',
      name: '董佳辉',
      avatarUrl: '/old.jpg'
    }, admin!.id)
    expect(created).toMatchObject({
      memberKey: 'dongjiahui',
      linkedAccount: 'dongjiahui'
    })

    const updated = await updateCmsMember(created!.id, {
      name: '董佳辉（测试）',
      avatarUrl: '/new.jpg'
    }, admin!.id)
    expect(updated).toMatchObject({
      memberKey: 'dongjiahui',
      name: '董佳辉（测试）',
      avatarUrl: '/new.jpg'
    })
  })

  it('扫描全部文章、解析 Frontmatter、搜索和按目录筛选，并保持 UUID 稳定', async () => {
    await mkdir(join(contentRoot, 'wiki', 'guide'), { recursive: true })
    await writeFile(
      join(contentRoot, 'news', 'hello.md'),
      markdown('title: 新闻标题\ntags:\n  - 比赛', '机器人比赛正文')
    )
    await writeFile(
      join(contentRoot, 'wiki', 'guide', 'index.md'),
      markdown('title: Wiki 指南', '安装说明')
    )

    expect(await synchronizeCmsArticles()).toBe(2)
    const all = await listCmsArticles()
    expect(all.total).toBe(2)
    expect(all.directories).toEqual(['news', 'wiki/guide'])
    expect((await listCmsArticles({ query: '机器人' })).articles[0]?.title).toBe('新闻标题')
    expect((await listCmsArticles({ directory: 'wiki/guide' })).total).toBe(1)

    const news = all.articles.find(article => article.collection === 'news')!
    expect((await getCmsArticle(news.id))?.frontmatter.tags).toEqual(['比赛'])
    await writeFile(
      join(contentRoot, 'news', 'hello.md'),
      markdown('title: 修改后的标题', '机器人比赛正文')
    )
    await synchronizeCmsArticles()
    const afterRename = await listCmsArticles({ collection: 'news' })
    expect(afterRename.articles[0]).toMatchObject({ id: news.id, title: '修改后的标题' })
  })

  it('拒绝通过恶意相对路径读取允许目录之外的文件', async () => {
    const [row] = await getDatabase().insert(articles).values({
      collection: 'news',
      relativePath: '../../.env',
      publicPath: '/news/escape',
      directory: 'news',
      title: '非法路径',
      searchText: 'escape',
      contentHash: '0'.repeat(64)
    }).returning({ id: articles.id })

    await expect(getCmsArticle(row!.id)).rejects.toThrow('CONTENT_PATH_OUTSIDE_ROOT')
    expect(await getDatabase().select().from(articles).where(eq(articles.id, row!.id))).toHaveLength(1)
  })
})
