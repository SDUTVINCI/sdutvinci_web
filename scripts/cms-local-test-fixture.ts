import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { Pool } from 'pg'
import { closeDatabase } from '../server/db/client'
import { parseCmsMarkdown } from '../server/utils/cms-frontmatter'
import { bootstrapCmsAdmin, countAdmins } from '../server/services/cms-auth'
import {
  getCmsArticleDirectory,
  getCmsArticlePublicPath
} from '../server/services/cms-articles'
import { applyCmsMemberMarkdownMigration } from '../server/services/cms-members'

const expectedDatabase = 'vinci_cms_local_test'
const adminAccount = 'testadmin'
const adminPassword = 'VinciLocalTest!2026'

const walkMarkdown = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const paths = await Promise.all(entries.map((entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return walkMarkdown(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  }))
  return paths.flat().sort()
}

const assertTestDatabase = () => {
  const databaseUrl = new URL(process.env.DATABASE_URL || '')
  const database = databaseUrl.pathname.replace(/^\//, '')
  if (database !== expectedDatabase || !/(^|_)test($|_)/.test(database)) {
    throw new Error(`只允许写入隔离数据库 ${expectedDatabase}`)
  }
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
    throw new Error('本地测试数据库必须使用回环地址')
  }
}

const importArticles = async (contentRoot: string) => {
  const fixtures: Array<{ collection: 'news' | 'wiki', relativePath: string }> = []
  for (const collection of ['news', 'wiki'] as const) {
    const collectionRoot = resolve(contentRoot, collection)
    for (const path of await walkMarkdown(collectionRoot)) {
      fixtures.push({
        collection,
        relativePath: relative(collectionRoot, path).replaceAll('\\', '/')
      })
    }
  }
  if (!fixtures.length) {
    throw new Error('独立内容仓库没有可导入的新闻或 Wiki Markdown')
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (const item of fixtures) {
      const source = await readFile(resolve(contentRoot, item.collection, item.relativePath), 'utf8')
      const parsed = parseCmsMarkdown(source)
      const title = typeof parsed.frontmatter.title === 'string'
        ? parsed.frontmatter.title.trim()
        : item.relativePath
      const contentHash = createHash('sha256').update(source).digest('hex')
      const requestedId = typeof parsed.frontmatter.vinciId === 'string'
        ? parsed.frontmatter.vinciId
        : null
      const articleResult = await client.query<{ id: string }>(
        `insert into articles
          (id, collection, relative_path, public_path, directory, title, frontmatter,
           search_text, content_hash, is_present)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'true')
         returning id`,
        [
          requestedId,
          item.collection,
          item.relativePath,
          getCmsArticlePublicPath(item.collection, item.relativePath),
          getCmsArticleDirectory(item.collection, item.relativePath),
          title,
          JSON.stringify(parsed.frontmatter),
          `${title}\n${item.relativePath}\n${parsed.body}`.toLowerCase(),
          contentHash
        ]
      )
      const articleId = articleResult.rows[0]!.id
      const revisionResult = await client.query<{ id: string }>(
        `insert into article_revisions
          (article_id, revision_number, markdown_source, body, frontmatter, content_hash, source_kind)
         values ($1, 1, $2, $3, $4::jsonb, $5, 'backfill') returning id`,
        [articleId, source, parsed.body, JSON.stringify(parsed.frontmatter), contentHash]
      )
      await client.query(
        'update articles set current_revision_id = $1 where id = $2',
        [revisionResult.rows[0]!.id, articleId]
      )
    }
    await client.query('commit')
    return fixtures.length
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

const main = async () => {
  assertTestDatabase()
  const contentRoot = resolve(process.env.CMS_CONTENT_ROOT || '')
  if (!contentRoot || !contentRoot.endsWith('sdutvinci_content')) {
    throw new Error('CMS_CONTENT_ROOT 必须指向独立 sdutvinci_content 仓库')
  }
  if (await countAdmins() !== 0) throw new Error('隔离测试库必须从零个管理员开始')

  const articleCount = await importArticles(contentRoot)
  const memberResult = await applyCmsMemberMarkdownMigration()
  const admin = await bootstrapCmsAdmin({ account: adminAccount, password: adminPassword })
  if (!admin || !admin.roles.includes('admin')) throw new Error('测试管理员创建失败')

  process.stdout.write(`${JSON.stringify({
    articleCount,
    memberCount: memberResult.memberCount,
    adminAccount
  })}\n`)
}

main().catch((error) => {
  console.error('本地 CMS 测试夹具创建失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
}).finally(closeDatabase)
