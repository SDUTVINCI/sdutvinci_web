import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  CMS_BATCH_WORKFLOW_CONCURRENCY,
  runCmsBatchAction
} from '../server/services/cms-batch-workflow'
import { CMS_BATCH_WORKFLOW_MAX_ITEMS } from '../shared/types/cms-drafts'

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

  it('500 项最多并发 10 个，并按输入顺序返回逐项结果', async () => {
    const items = Array.from({ length: CMS_BATCH_WORKFLOW_MAX_ITEMS }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      version: index + 1
    }))
    let active = 0
    let maxActive = 0
    const results = await runCmsBatchAction(items, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, item.version % 4))
      active -= 1
      if (item.version === 250) throw new Error('failure fixture')
      return `done-${item.version}`
    })

    expect(CMS_BATCH_WORKFLOW_MAX_ITEMS).toBe(500)
    expect(CMS_BATCH_WORKFLOW_CONCURRENCY).toBe(10)
    expect(maxActive).toBe(10)
    expect(results.map(item => item.id)).toEqual(items.map(item => item.id))
    expect(results[249]).toEqual({
      id: items[249]!.id,
      ok: false,
      message: '操作失败，请打开单篇内容查看详情'
    })
  })

  it('页面公开分类和状态计数筛选、明确高风险入口和三种批量操作', async () => {
    const [importsPage, draftsPage, reviewsPage] = await Promise.all([
      readFile('app/pages/cms/content-imports/index.vue', 'utf8'),
      readFile('app/pages/cms/drafts/index.vue', 'utf8'),
      readFile('app/pages/cms/reviews/index.vue', 'utf8')
    ])
    expect(importsPage).toContain('按风险分类筛选文件')
    expect(importsPage).toContain('按处理状态筛选文件')
    expect(importsPage).toContain('风险分类和处理状态可组合使用')
    expect(importsPage).toContain('已导入草稿 / 提案')
    expect(importsPage).toContain('statusFilter')
    expect(importsPage).toContain('blockedReason(item)')
    expect(importsPage).toContain('IMPORT_ACTIVE_DRAFT_EXISTS')
    expect(importsPage).toContain('全选当前可导入结果')
    expect(importsPage).toContain('取消全选当前结果')
    expect(importsPage).toContain('filteredSelectableItems')
    expect(importsPage).toContain('强制导入此高风险项（仍需输入确认短语）')
    expect(importsPage).toContain('classificationFilter')
    expect(draftsPage).toContain('全选可提交草稿')
    expect(draftsPage).toContain('批量提交审核')
    expect(reviewsPage).toContain('全选待审核')
    expect(reviewsPage).toContain('全选待发布')
    expect(reviewsPage).toContain('批量审核通过')
    expect(reviewsPage).toContain('批量正式发布')
    expect(reviewsPage).toContain('已通过，等待发布')
  })

  it('三个批量 API 共用 500 项请求上限', async () => {
    const apiSources = await Promise.all([
      readFile('server/api/cms/drafts/batch-submit.post.ts', 'utf8'),
      readFile('server/api/cms/reviews/batch-approve.post.ts', 'utf8'),
      readFile('server/api/cms/reviews/batch-publish.post.ts', 'utf8')
    ])
    expect(apiSources.every(source => source.includes('CMS_BATCH_WORKFLOW_MAX_ITEMS'))).toBe(true)
    expect(apiSources.every(source => !source.includes('.max(100)'))).toBe(true)
  })
})
