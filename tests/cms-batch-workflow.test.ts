import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runCmsBatchAction } from '../server/services/cms-batch-workflow'

describe('CMS 批量工作流结果隔离', () => {
  it('逐项执行并保留部分成功和部分失败结果', async () => {
    const calls: string[] = []
    const results = await runCmsBatchAction([
      { id: '11111111-1111-4111-8111-111111111111', version: 1 },
      { id: '22222222-2222-4222-8222-222222222222', version: 2 },
      { id: '33333333-3333-4333-8333-333333333333', version: 3 }
    ], async (item) => {
      calls.push(item.id)
      if (item.version === 2) throw new Error('failure fixture')
      return '操作成功'
    })

    expect(calls).toHaveLength(3)
    expect(results).toEqual([
      { id: '11111111-1111-4111-8111-111111111111', ok: true, message: '操作成功' },
      { id: '22222222-2222-4222-8222-222222222222', ok: false, message: '操作失败，请打开单篇内容查看详情' },
      { id: '33333333-3333-4333-8333-333333333333', ok: true, message: '操作成功' }
    ])
  })

  it('页面公开分类筛选、明确高风险入口和三种批量操作', async () => {
    const [importsPage, draftsPage, reviewsPage] = await Promise.all([
      readFile('app/pages/cms/content-imports/index.vue', 'utf8'),
      readFile('app/pages/cms/drafts/index.vue', 'utf8'),
      readFile('app/pages/cms/reviews/index.vue', 'utf8')
    ])
    expect(importsPage).toContain('按风险分类筛选文件')
    expect(importsPage).toContain('强制导入此高风险项（仍需输入确认短语）')
    expect(importsPage).toContain('classificationFilter')
    expect(draftsPage).toContain('批量提交审核')
    expect(reviewsPage).toContain('批量审核通过')
    expect(reviewsPage).toContain('批量正式发布')
    expect(reviewsPage).toContain('已通过，等待发布')
  })
})
