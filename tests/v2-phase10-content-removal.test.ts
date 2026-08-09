import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildContentImportContext,
  buildContentImportDiff
} from '../shared/utils/content-import-diff'
import { getWikiContentMeta } from '../utils/wiki-content-meta'
import { compareWikiChapters, numberWikiChapters } from '../utils/wiki-chapters'

const missing = async (path: string) => {
  await expect(access(path, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' })
}

describe('V2 阶段 10 Nuxt Content 与代码仓库内容目录剔除', () => {
  it('依赖、配置、transformer 和三类正式内容目录均已移除', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'))
    expect(packageJson.dependencies).not.toHaveProperty('@nuxt/content')
    expect(packageJson.dependencies).not.toHaveProperty('better-sqlite3')
    expect(packageLock.packages).not.toHaveProperty('node_modules/@nuxt/content')
    expect(packageLock.packages).not.toHaveProperty('node_modules/better-sqlite3')
    await Promise.all([
      missing('content.config.ts'),
      missing('transformers/wiki-pinyin-path.ts'),
      missing('content/news'),
      missing('content/wiki'),
      missing('content/members')
    ])
  })

  it('公开页面和 CMS 正式预览只使用数据库 API 与 VinciMarkdownRenderer', async () => {
    const paths = [
      'app/pages/index.vue',
      'app/pages/news/index.vue',
      'app/pages/news/[slug].vue',
      'app/pages/wiki/index.vue',
      'app/pages/wiki/[...slug].vue',
      'app/components/WikiList.vue',
      'app/pages/team/index.vue',
      'app/pages/team/[slug].vue',
      'app/pages/cms/articles/[id]/index.vue'
    ]
    const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')))
    for (const source of sources) {
      expect(source).not.toContain('queryCollection')
      expect(source).not.toContain('ContentRenderer')
      expect(source).not.toContain('nuxt_content')
    }
    for (const source of [sources[2], sources[4], sources[7], sources[8]]) {
      expect(source).toContain('VinciMarkdownRenderer')
    }
  })

  it('production 构建、Docker runtime 和 Actions 不复制或分类正式 Markdown', async () => {
    const [nuxt, dockerfile, workflow, classifier, deploy, compose, entrypoint] = await Promise.all([
      readFile('nuxt.config.ts', 'utf8'),
      readFile('Dockerfile', 'utf8'),
      readFile('.github/workflows/deploy.yml', 'utf8'),
      readFile('scripts/classify-deployment.sh', 'utf8'),
      readFile('scripts/deploy.sh', 'utf8'),
      readFile('compose.yaml', 'utf8'),
      readFile('docker/entrypoint.sh', 'utf8')
    ])
    expect(nuxt).not.toContain('@nuxt/content')
    expect(nuxt).not.toContain('content:file:')
    expect(dockerfile).not.toMatch(/COPY[^\n]+\/content\b/)
    expect(dockerfile).toContain("test ! -e /app/content")
    expect(dockerfile).toContain("find /app -type f -name '*.md'")
    expect(workflow).not.toContain('content-only')
    expect(workflow).not.toContain('needs.classify')
    expect(workflow).toContain('cn.vinci.deployment.mode=application')
    expect(workflow).toContain('npm run test:v2:phase10')
    expect(classifier.trim().endsWith("printf 'application\\n'")).toBe(true)
    expect(deploy).not.toContain('纯 content/')
    expect(deploy).toContain('candidate_service="app-${candidate_slot}"')
    expect(deploy).toContain('blue|green')
    expect(deploy).toContain('--force-recreate content-export-worker')
    expect(deploy).toContain('previous_worker_image')
    expect(deploy).toContain('恢复原内容导出 Worker 镜像')
    expect(compose).not.toContain('cms_git_worktree:')
    expect(compose).not.toContain('/app/content')
    expect(compose).toContain('CONTENT_PUBLISH_MODE: database')
    expect(entrypoint).not.toContain('cms_git_ssh_key')
    expect(entrypoint).not.toContain('CMS_GIT_WORKTREE')
  })

  it('公开 API、SEO feed 与动态 SSR 路由固定使用数据库路径', async () => {
    const [nuxt, news, wiki, members, search, sitemap, rss] = await Promise.all([
      readFile('nuxt.config.ts', 'utf8'),
      readFile('server/api/v2/content/news/index.get.ts', 'utf8'),
      readFile('server/api/v2/content/wiki/index.get.ts', 'utf8'),
      readFile('server/api/v2/content/members/index.get.ts', 'utf8'),
      readFile('server/api/v2/content/search.get.ts', 'utf8'),
      readFile('server/routes/sitemap.xml.get.ts', 'utf8'),
      readFile('server/routes/rss.xml.get.ts', 'utf8')
    ])
    expect(nuxt).toContain("'/news/**': { prerender: false }")
    expect(nuxt).toContain("'/wiki/**': { prerender: false }")
    expect(nuxt).toContain("'/team/**': { prerender: false }")
    for (const source of [news, wiki, members, search, sitemap, rss]) {
      expect(source).toContain('public-content')
      expect(source).not.toContain('public-content-flags')
      expect(source).not.toContain('requirePublicDatabaseCandidate')
    }
  })

  it('Wiki 普通模块保持拼音路径、章节深度和顺序', () => {
    expect(getWikiContentMeta('wiki/2026-08-02-阶段十测试/0100-0200-数据库页面'))
      .toMatchObject({
        path: '/wiki/2026-08-02-jie-duan-shi-ce-shi/0100-0200-shu-ju-ku-ye-mian',
        chapterOrder: '0100-0200',
        chapterDepth: 1,
        docRoot: '/wiki/2026-08-02-jie-duan-shi-ce-shi',
        isWikiDoc: true,
        isWikiIndex: false
      })
    const chapters = numberWikiChapters([
      { title: '第二章', chapterOrder: '0200' },
      { title: '第一章子节', chapterOrder: '0100-0300' },
      { title: '第一章', chapterOrder: '0100' }
    ]).sort(compareWikiChapters)
    expect(chapters.map(item => [item.title, item.chapter, item.chapterDepth]))
      .toEqual([
        ['第一章', '1', 0],
        ['第一章子节', '1.1', 1],
        ['第二章', '2', 0]
      ])
  })

  it('PR 导入共享 Diff helper 保留上下文、替换、增删和双侧行号', () => {
    const lines = buildContentImportDiff(
      'alpha\nold\nomega\n',
      'alpha\nnew\nextra\nomega\n'
    )
    expect(lines).toEqual([
      { kind: 'context', prefix: ' ', text: 'alpha', oldLine: 1, newLine: 1 },
      { kind: 'removed', prefix: '-', text: 'old', oldLine: 2, newLine: null },
      { kind: 'added', prefix: '+', text: 'new', oldLine: null, newLine: 2 },
      { kind: 'added', prefix: '+', text: 'extra', oldLine: null, newLine: 3 },
      { kind: 'context', prefix: ' ', text: 'omega', oldLine: 3, newLine: 4 }
    ])
    expect(buildContentImportContext('one\ntwo\n')).toEqual([
      { kind: 'context', prefix: ' ', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'context', prefix: ' ', text: 'two', oldLine: 2, newLine: 2 }
    ])
  })

  it('阶段 8/9 PR 导入的中文、安全、内联和可访问语义没有回退', async () => {
    const page = await readFile('app/pages/cms/content-imports/index.vue', 'utf8')
    for (const text of [
      '不会批准、发布、Merge',
      '把检查结果留言到 PR',
      '关闭这个 PR（仅管理员）',
      'Base（开始修改时的原文）',
      'Current（数据库现在的正式内容）',
      'Proposed（这个 PR 想改成的内容）',
      'Merge（导入后将进入草稿的内容）',
      '收起三方审计材料',
      ':aria-expanded="artifact?.id === item.id"',
      ':aria-controls="`artifact-${item.id}`"',
      ':data-kind="line.kind"',
      '这个 PR 提议删除整项内容。',
      '无法安全合并，因此不会创建合并草稿。',
      '数据库中还没有这项正式内容。',
      '该内容因冲突或安全原因没有提供。'
    ]) expect(page).toContain(text)
  })
})
