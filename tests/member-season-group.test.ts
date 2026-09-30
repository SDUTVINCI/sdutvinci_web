import { describe, expect, it } from 'vitest'
import { memberSeasonGroup } from '../shared/utils/member-season-group'

describe('按赛季展示成员', () => {
  it('参加和担任顾问的赛季重叠时展示在原组别，只有顾问的赛季展示在顾问组', () => {
    const member = { type: '顾问', group: '机械组', time: '26', advisor: '26,27' }
    expect(memberSeasonGroup(member, '26', ['机械组'])).toBe('group:机械组')
    expect(memberSeasonGroup(member, '27', ['机械组'])).toBe('advisors')
    expect(memberSeasonGroup(member, 'all', ['机械组'])).toBe('group:机械组')
  })

  it('指导老师始终展示在指导老师分组', () => {
    expect(memberSeasonGroup({ type: '指导老师', time: '27' }, '27', ['机械组'])).toBe('teachers')
  })
})
