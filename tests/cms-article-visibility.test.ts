import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  PUBLIC_ARTICLE_AUTH_REQUIRED_CODE,
  isPublicArticleAuthRequiredError
} from '../shared/utils/public-article-access'

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

  it('受限详情跳转登录并保留原文章路径，缺失详情仍走 404', async () => {
    const [newsPage, wikiPage, loginPage, newsApi, wikiApi] = await Promise.all([
      readFile('app/pages/news/[slug].vue', 'utf8'),
      readFile('app/pages/wiki/[...slug].vue', 'utf8'),
      readFile('app/pages/cms/login.vue', 'utf8'),
      readFile('server/api/v2/content/news/[...slug].get.ts', 'utf8'),
      readFile('server/api/v2/content/wiki/[...slug].get.ts', 'utf8')
    ])

    for (const page of [newsPage, wikiPage]) {
      expect(page).toContain('isPublicArticleAuthRequiredError(pageError.value)')
      expect(page).toContain("path: '/cms/login'")
      expect(page).toContain('redirect: route.fullPath')
      expect(page).toContain('statusCode: 404')
    }
    for (const api of [newsApi, wikiApi]) {
      expect(api).toContain('PUBLIC_ARTICLE_AUTH_REQUIRED_CODE')
      expect(api).toContain('statusCode: 401')
      expect(api).toContain('statusCode: 404')
    }
    expect(loginPage).toContain('登录后将自动返回原文章')
    expect(loginPage).toContain('登录并返回文章')
  })

  it('只识别带受限文章错误码的 401', () => {
    expect(isPublicArticleAuthRequiredError({
      statusCode: 401,
      data: { code: PUBLIC_ARTICLE_AUTH_REQUIRED_CODE }
    })).toBe(true)
    expect(isPublicArticleAuthRequiredError({
      statusCode: 401,
      data: { data: { code: PUBLIC_ARTICLE_AUTH_REQUIRED_CODE } }
    })).toBe(true)
    expect(isPublicArticleAuthRequiredError({ statusCode: 401 })).toBe(false)
    expect(isPublicArticleAuthRequiredError({
      statusCode: 404,
      data: { code: PUBLIC_ARTICLE_AUTH_REQUIRED_CODE }
    })).toBe(false)
  })
})
