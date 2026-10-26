import { describe, expect, it } from 'vitest'
import { reviewHistoryQuerySchema } from '../server/utils/cms-review-history-query'

describe('审核历史查询边界', () => {
  it('默认分页且限制参数范围和类型', () => {
    expect(reviewHistoryQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 })
    for (const query of [{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { kind: 'user' }, { action: 'pending' }, { reviewer: 'invalid' }, { batch: 'invalid' }, { from: '2026-02-30' }, { from: '2026-10-28', to: '2026-10-27' }]) {
      expect(reviewHistoryQuerySchema.safeParse(query).success).toBe(false)
    }
  })
  it('北京时间日期范围包含结束日期的整天', () => {
    const result = reviewHistoryQuerySchema.parse({ from: '2026-10-27', to: '2026-10-27', query: '  成员  ' })
    expect(result.from?.toISOString()).toBe('2026-10-26T16:00:00.000Z')
    expect(result.until?.toISOString()).toBe('2026-10-27T16:00:00.000Z')
    expect(result.query).toBe('成员')
  })
})
