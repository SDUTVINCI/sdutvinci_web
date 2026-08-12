import { describe, expect, it } from 'vitest'
import {
  CONTENT_PR_IMPORT_PLAN_CONCURRENCY,
  mapContentImportConcurrently
} from '../server/utils/content-import-concurrency'

describe('内容 PR 文件有界并发规划', () => {
  it('311 项最多并发 10 个，并按输入顺序返回结果', async () => {
    const items = Array.from({ length: 311 }, (_, index) => index)
    let active = 0
    let maxActive = 0

    const results = await mapContentImportConcurrently(items, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, item % 7))
      active -= 1
      return `planned-${item}`
    })

    expect(CONTENT_PR_IMPORT_PLAN_CONCURRENCY).toBe(10)
    expect(maxActive).toBe(10)
    expect(results).toEqual(items.map(item => `planned-${item}`))
  })

  it('空输入不启动 worker，少量输入不创建多余并发', async () => {
    expect(await mapContentImportConcurrently([], async item => item)).toEqual([])

    let active = 0
    let maxActive = 0
    const results = await mapContentImportConcurrently([1, 2, 3], async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
      return item * 2
    })

    expect(maxActive).toBe(3)
    expect(results).toEqual([2, 4, 6])
  })
})
