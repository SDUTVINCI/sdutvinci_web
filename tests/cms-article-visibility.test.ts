import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('文章访问权限入口与 Wiki 文章计数', () => {
  it('权限写接口仅允许管理员并要求 CSRF', async () => {
    const source = await readFile(
      'server/api/cms/articles/visibility.patch.ts',
      'utf8'
    )
    expect(source).toContain("requireCmsRequestAuth(event, 'admin')")
    expect(source).toContain('requireCmsCsrf(event, auth)')
    expect(source).toContain('CMS_ARTICLE_VISIBILITY_MAX_ITEMS')
  })

  it('CMS 文章页支持权限筛选、全选、批量设置和逐篇切换', async () => {
    const source = await readFile('app/pages/cms/articles/index.vue', 'utf8')
    expect(source).toContain('全选当前结果')
    expect(source).toContain('设为未登录可见')
    expect(source).toContain('设为需登录')
    expect(source).toContain('toggleArticleVisibility')
  })

  it('Wiki 目录文章数包含 index 首页', async () => {
    const source = await readFile('app/components/WikiList.vue', 'utf8')
    expect(source).toContain('doc.chapters.length + (doc.index ? 1 : 0)')
    expect(source).toContain('{{ articleCount(doc) }} 篇文章')
    expect(source).toContain("wiki.isWikiIndex ? (wiki.docRoot || wiki.path) : wiki.path")
  })
})
