import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 文章详情回归', () => {
  it('保留接口真实错误并按文章集合渲染正式预览', async () => {
    const page = await readFile('app/pages/cms/articles/[id]/index.vue', 'utf8')

    expect(page).toContain('const { data, error, refresh } = await useAsyncData')
    expect(page).toContain('statusCode: error.value.statusCode || 500')
    expect(page).toContain(':variant="article.collection"')
  })
})
