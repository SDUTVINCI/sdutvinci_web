import { describe, expect, it } from 'vitest'
import type { PublicArticleCreditIdentity } from '../shared/types/article-credit-identities'
import {
  formatArticleCreditDate,
  resolveArticleCredits
} from '../shared/utils/article-credits'

const members = [
  {
    memberKey: 'dongjiahui', path: '/team/dongjiahui',
    name: '董佳辉', image: '/avatars/dongjiahui.webp'
  },
  {
    memberKey: 'fangzihao', path: '/team/fangzihao',
    name: '房子豪', image: '/avatars/fangzihao.webp'
  }
] satisfies PublicArticleCreditIdentity[]

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

  it('非正式成员可用稳定拼音 ID 显示登记的中文署名且不生成成员链接', () => {
    expect(resolveArticleCredits(
      ['cuitonghui'],
      ['sunjianghui'],
      [
        { memberKey: 'cuitonghui', name: '崔桐汇', image: null, path: null },
        { memberKey: 'sunjianghui', name: '孙江辉', image: null, path: null }
      ]
    )).toEqual({
      authors: [{ memberKey: 'cuitonghui', name: '崔桐汇', image: null, path: null }],
      collaborators: [{ memberKey: 'sunjianghui', name: '孙江辉', image: null, path: null }]
    })
  })
})
