import { describe, expect, it } from 'vitest'
import type { PublicMember } from '../shared/types/public-content'
import {
  formatArticleCreditDate,
  resolveArticleCredits
} from '../shared/utils/article-credits'

const members = [
  {
    id: 'dongjiahui', vinciId: '1', memberKey: 'dongjiahui', path: '/team/dongjiahui',
    name: '董佳辉', image: '/avatars/dongjiahui.webp', body: '', metadata: {}, cacheKey: '1', updatedAt: '2026-08-12'
  },
  {
    id: 'fangzihao', vinciId: '2', memberKey: 'fangzihao', path: '/team/fangzihao',
    name: '房子豪', image: '/avatars/fangzihao.webp', body: '', metadata: {}, cacheKey: '2', updatedAt: '2026-08-12'
  }
] satisfies PublicMember[]

describe('文章署名信息', () => {
  it('按稳定 ID 解析姓名头像，去重并排除作者中已有的协作者', () => {
    expect(resolveArticleCredits(
      ['dongjiahui', 'dongjiahui'],
      ['dongjiahui', 'fangzihao', 'unknown'],
      members
    )).toEqual({
      authors: [{
        memberKey: 'dongjiahui', name: '董佳辉', image: '/avatars/dongjiahui.webp', path: '/team/dongjiahui'
      }],
      collaborators: [
        { memberKey: 'fangzihao', name: '房子豪', image: '/avatars/fangzihao.webp', path: '/team/fangzihao' },
        { memberKey: 'unknown', name: 'unknown', image: null, path: null }
      ]
    })
  })

  it('忽略非数组署名并安全格式化日期', () => {
    expect(resolveArticleCredits('dongjiahui', null, members)).toEqual({ authors: [], collaborators: [] })
    expect(formatArticleCreditDate('2026-08-12T03:05:07.365Z')).toBe('2026/08/12')
    expect(formatArticleCreditDate('invalid')).toBe('')
  })
})
