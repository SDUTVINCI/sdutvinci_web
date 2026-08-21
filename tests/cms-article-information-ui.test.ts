import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 文章信息界面', () => {
  it('草稿设置使用居中分区弹层与紧凑标签选项', async () => {
    const [page, styles] = await Promise.all([
      readFile('app/pages/cms/drafts/[id].vue', 'utf8'),
      readFile('app/assets/css/cms.css', 'utf8')
    ])

    expect(page).toContain('cms-document-settings-layer')
    expect(page).toContain('aria-labelledby="cms-document-settings-title"')
    expect(page).toContain('文章标题 <code>title</code>')
    expect(page).toContain('内容摘要 <code>description</code>')
    expect(page).toContain('组别标签（可多选）')
    expect(page).toContain('cms-settings-footer')
    expect(styles).toContain('width: min(920px, 100%);')
    expect(styles).toContain('.cms-draft-fields .cms-choice-fieldset .cms-tag-choice input')
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
  })

  it('正式文章详情将元数据、版本与导出状态分组展示', async () => {
    const page = await readFile('app/pages/cms/articles/[id]/index.vue', 'utf8')

    expect(page).toContain('const frontmatterEntries = computed')
    expect(page).toContain('cms-article-inspector')
    expect(page).toContain('内容元数据')
    expect(page).toContain('查看原始 Frontmatter')
    expect(page).toContain('版本与完整性')
    expect(page).toContain('内容仓库同步')
    expect(page).toContain('/api/v2/content/article-credits')
    expect(page).toContain('cms-metadata-person')
    expect(page).toContain('person.name')
    expect(page).not.toContain('<h2>Frontmatter</h2>')
  })
})
