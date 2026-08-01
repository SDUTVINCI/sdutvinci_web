import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { articleRevisions, articles } from '../server/db/schema'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import {
  buildContentRepositoryMetadata,
  serializeContentRevision
} from '../server/services/content-export-serialization'
import { writeCmsMarkdown } from '../server/utils/cms-frontmatter'

const exec = promisify(execFile)
const stateRoot = process.env.PHASE8_MANUAL_STATE_ROOT || ''
const databaseUrl = process.env.DATABASE_URL || ''
const database = new URL(databaseUrl)
if (!stateRoot.endsWith('/vinci-v2-phase8-manual-test')) {
  throw new Error('PHASE8_MANUAL_STATE_ROOT_INVALID')
}
if (!['127.0.0.1', 'localhost'].includes(database.hostname)
  || !database.pathname.includes('manual_test')) {
  throw new Error('PHASE8_MANUAL_DATABASE_NOT_ISOLATED')
}

const workspace = join(stateRoot, 'content-workspace')
const remote = join(stateRoot, 'content-remote.git')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const write = async (root: string, path: string, source: string) => {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, source, 'utf8')
}

interface SeededArticle {
  id: string
  path: string
  relativePath: string
  baseSource: string
  currentSource: string
  snapshot: {
    articleId: string
    revisionId: string
    revisionNumber: number
    collection: 'wiki'
    relativePath: string
    path: string
    sha256: string
    bytes: number
  }
}

const seedArticle = async (relativePath: string, title: string, baseBody: string, currentBody = baseBody) => {
  const db = getDatabase()
  const id = randomUUID()
  const baseRevisionId = randomUUID()
  const baseFrontmatter = { title, authors: [], updatedAt: '2026-08-01T00:00:00.000Z' }
  const baseMarkdown = writeCmsMarkdown(baseFrontmatter, baseBody)
  const base = serializeContentRevision({
    articleId: id,
    collection: 'wiki',
    relativePath,
    revisionId: baseRevisionId,
    revisionNumber: 1,
    frontmatter: baseFrontmatter,
    body: baseBody,
    revisionCreatedAt: new Date('2026-08-01T00:00:00.000Z')
  })
  await db.insert(articles).values({
    id,
    collection: 'wiki',
    relativePath,
    publicPath: `/wiki/${relativePath.replace(/\.md$/, '')}`,
    directory: dirname(relativePath) === '.' ? 'wiki' : `wiki/${dirname(relativePath)}`,
    title,
    frontmatter: baseFrontmatter,
    searchText: `${title}\n${baseBody}`,
    contentHash: sha256(baseMarkdown)
  })
  await db.insert(articleRevisions).values({
    id: baseRevisionId,
    articleId: id,
    revisionNumber: 1,
    markdownSource: baseMarkdown,
    body: baseBody,
    frontmatter: baseFrontmatter,
    contentHash: sha256(baseMarkdown),
    sourceKind: 'backfill',
    createdAt: new Date('2026-08-01T00:00:00.000Z')
  })
  let currentRevisionId = baseRevisionId
  let currentSource = base.source
  if (currentBody !== baseBody) {
    currentRevisionId = randomUUID()
    const currentFrontmatter = { ...baseFrontmatter, updatedAt: '2026-08-02T00:00:00.000Z' }
    const currentMarkdown = writeCmsMarkdown(currentFrontmatter, currentBody)
    const current = serializeContentRevision({
      articleId: id,
      collection: 'wiki',
      relativePath,
      revisionId: currentRevisionId,
      revisionNumber: 2,
      frontmatter: currentFrontmatter,
      body: currentBody,
      revisionCreatedAt: new Date('2026-08-02T00:00:00.000Z')
    })
    currentSource = current.source
    await db.insert(articleRevisions).values({
      id: currentRevisionId,
      articleId: id,
      revisionNumber: 2,
      markdownSource: currentMarkdown,
      body: currentBody,
      frontmatter: currentFrontmatter,
      contentHash: sha256(currentMarkdown),
      sourceKind: 'publish',
      createdAt: new Date('2026-08-02T00:00:00.000Z')
    })
  }
  await db.update(articles).set({ currentRevisionId }).where(eq(articles.id, id))
  return {
    id,
    path: `wiki/${relativePath}`,
    relativePath,
    baseSource: base.source,
    currentSource,
    snapshot: {
      articleId: id,
      revisionId: baseRevisionId,
      revisionNumber: 1,
      collection: 'wiki' as const,
      relativePath,
      path: `wiki/${relativePath}`,
      sha256: base.sha256,
      bytes: base.bytes
    }
  } satisfies SeededArticle
}

const main = async () => {
  await runMigrations()
  await getDatabase().execute(`
    truncate table rate_limit_buckets, media_assets, content_pr_external_actions,
    content_pr_import_items, content_pr_import_runs, content_import_items,
    content_import_runs, content_reconciliation_runs, content_export_jobs,
    content_export_runs, article_redirects, article_deletion_events,
    publish_records, edit_locks, review_events, audit_logs, sessions,
    draft_authors, article_revisions, drafts, user_members, user_roles,
    articles, members, users restart identity cascade
  `)
  await bootstrapCmsAdmin({ account: 'phase8admin', password: 'Phase8Manual123!' })
  const safe = await seedArticle('phase8/safe.md', '安全修改', '安全修改的 Base 正文。\n')
  const automatic = await seedArticle(
    'phase8/automatic.md',
    '不同段落自动合并',
    '第一段 Base。\n\n第二段 Base。\n',
    '第一段数据库 Current 修改。\n\n第二段 Base。\n'
  )
  const conflict = await seedArticle(
    'phase8/conflict.md',
    '同段冲突',
    '同一段 Base。\n',
    '同一段数据库 Current 修改。\n'
  )
  const moved = await seedArticle('phase8/old-name.md', '重命名提案', '保持相同 vinciId。\n')
  const deleted = await seedArticle('phase8/delete.md', '删除提案', '正式内容仍然存在。\n')
  const risky = await seedArticle('phase8/risky.md', '高风险语法', '普通正文。\n')
  const untouched = await seedArticle('phase8/untouched.md', '未修改文章', 'PR 不应影响我。\n')
  const seeded = [safe, automatic, conflict, moved, deleted, risky, untouched]
  const metadata = buildContentRepositoryMetadata(
    seeded.map(item => item.snapshot), [], new Date('2026-08-01T00:00:00.000Z')
  )

  await rm(workspace, { recursive: true, force: true })
  await rm(remote, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: workspace })
  await exec('git', ['config', 'user.name', 'Vinci Phase 8 Fixture'], { cwd: workspace })
  await exec('git', ['config', 'user.email', 'phase8-fixture@example.invalid'], { cwd: workspace })
  for (const item of seeded) await write(workspace, item.path, item.baseSource)
  await write(workspace, '.vinci/snapshot.json', metadata.snapshotSource)
  await write(workspace, 'manifest.json', metadata.manifestSource)
  await write(workspace, 'README.md', '# Vinci Phase 8 isolated PR fixture\n')
  await exec('git', ['add', '.'], { cwd: workspace })
  await exec('git', ['commit', '-m', 'test: phase 8 base snapshot'], { cwd: workspace })
  const { stdout: baseOutput } = await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })
  await exec('git', ['init', '--bare', remote])
  await exec('git', [`--git-dir=${remote}`, 'config', 'vinci.scope', 'v2-phase8-manual-test'])
  await exec('git', ['remote', 'add', 'origin', remote], { cwd: workspace })
  await exec('git', ['push', 'origin', 'main'], { cwd: workspace })
  await exec('git', ['switch', '-c', 'proposal/phase8'], { cwd: workspace })

  await write(workspace, safe.path, safe.baseSource.replace('安全修改的 Base 正文。', '安全 PR 修改。'))
  await write(workspace, automatic.path, automatic.baseSource.replace('第二段 Base。', '第二段 PR 修改。'))
  await write(workspace, conflict.path, conflict.baseSource.replace('同一段 Base。', '同一段 PR 修改。'))
  await write(workspace, 'wiki/phase8/new-name.md', moved.baseSource)
  await rm(join(workspace, moved.path))
  await rm(join(workspace, deleted.path))
  await write(workspace, risky.path, risky.baseSource.replace('普通正文。', '<script>alert("phase8")</script>'))
  await write(
    workspace,
    'wiki/phase8/new.md',
    writeCmsMarkdown({ title: 'PR 新文章', authors: [] }, '只创建草稿，ID 由数据库分配。\n')
  )
  await exec('git', ['add', '-A'], { cwd: workspace })
  await exec('git', ['commit', '-m', 'test: phase 8 proposal'], { cwd: workspace })
  const { stdout: headOutput } = await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })
  await exec('git', ['push', 'origin', 'HEAD:refs/heads/proposal/phase8'], { cwd: workspace })

  const pullFiles = [
    { filename: safe.path, status: 'modified', changes: 2 },
    { filename: automatic.path, status: 'modified', changes: 2 },
    { filename: conflict.path, status: 'modified', changes: 2 },
    { filename: 'wiki/phase8/new.md', status: 'added', changes: 4 },
    { filename: 'wiki/phase8/new-name.md', previous_filename: moved.path, status: 'renamed', changes: 0 },
    { filename: deleted.path, status: 'removed', changes: 2 },
    { filename: risky.path, status: 'modified', changes: 2 }
  ]
  const contents: Record<string, string> = {}
  for (const [commit, paths] of [
    [baseOutput.trim(), ['.vinci/snapshot.json', ...seeded.map(item => item.path)]],
    [headOutput.trim(), [
      safe.path,
      automatic.path,
      conflict.path,
      'wiki/phase8/new.md',
      'wiki/phase8/new-name.md',
      risky.path
    ]]
  ] as const) {
    for (const path of paths) {
      const { stdout } = await exec('git', [`--git-dir=${remote}`, 'show', `${commit}:${path}`])
      contents[`${commit}:${path}`] = stdout
    }
  }
  await writeFile(join(stateRoot, 'fixture.json'), `${JSON.stringify({
    repositoryId: 'SDUTVINCI/sdutvinci_content',
    pullRequestNumber: 8,
    baseCommit: baseOutput.trim(),
    headCommit: headOutput.trim(),
    files: pullFiles,
    contents,
    expected: {
      safeArticleId: safe.id,
      automaticArticleId: automatic.id,
      conflictArticleId: conflict.id,
      movedArticleId: moved.id,
      deletedArticleId: deleted.id,
      untouchedArticleId: untouched.id
    }
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(stateRoot, 'pull-state.json'), '{"state":"open"}\n', 'utf8')
  await writeFile(join(stateRoot, 'external-actions.jsonl'), '', 'utf8')
}

main().finally(closeDatabase)
