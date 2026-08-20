import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  buildPublishedSource,
  suggestCmsArticlePath
} from '../server/services/cms-publishing-legacy'
import { CMS_NEW_ARTICLE_RELATIVE_PATH_KEY } from '../server/services/cms-drafts'
import { parseCmsMarkdown } from '../server/utils/cms-frontmatter'

describe('CMS Wiki 主文档与章节结构', () => {
  it('Wiki 默认发布路径使用一级目录 index.md', () => {
    expect(suggestCmsArticlePath(
      'wiki',
      'OpenWrt 编译教学',
      '12345678-0000-0000-0000-000000000000'
    )).toBe('openwrt-编译教学-12345678/index.md')
  })

  it('发布时保留主文档 tags，但不泄露草稿内部计划路径字段', () => {
    const built = buildPublishedSource({
      preservedFrontmatter: {
        [CMS_NEW_ARTICLE_RELATIVE_PATH_KEY]: 'OpenWrt/index.md',
        tags: ['嵌入式组', '软件算法组']
      },
      title: 'OpenWrt 编译教学',
      description: '',
      authorKeys: [],
      body: '正文',
      now: new Date('2026-08-21T00:00:00.000Z')
    })
    const parsed = parseCmsMarkdown(built.source)
    expect(parsed.frontmatter.tags).toEqual(['嵌入式组', '软件算法组'])
    expect(parsed.frontmatter).not.toHaveProperty(CMS_NEW_ARTICLE_RELATIVE_PATH_KEY)
  })

  it('CMS 页面明确区分主文档、章节、所属关系与主文档标签', async () => {
    const [newPage, draftPage, listPage] = await Promise.all([
      readFile('app/pages/cms/articles/new.vue', 'utf8'),
      readFile('app/pages/cms/drafts/[id].vue', 'utf8'),
      readFile('app/pages/cms/articles/index.vue', 'utf8')
    ])
    expect(newPage).toContain("wikiContentType: 'document'")
    expect(newPage).toContain('所属 Wiki 主文档')
    expect(newPage).toContain('资料日期')
    expect(newPage).toContain('资料名称（不含日期）')
    expect(newPage).toContain('最终一级目录（自动生成）')
    expect(newPage).toContain('readonly')
    expect(newPage).toContain('wiki-path-availability')
    expect(newPage).toContain('WIKI_DOCUMENT_TAGS')
    expect(draftPage).toContain("initial.wikiContentType === 'document'")
    expect(draftPage).toContain('所有章节继承这里的标签')
    expect(listPage).toContain('属于：{{ wikiDocumentTitle(article.relativePath) }}')
    expect(listPage).toContain('旧式独立页')
  })
})
