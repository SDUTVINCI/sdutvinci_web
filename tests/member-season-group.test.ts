import { describe, expect, it } from 'vitest'
import { memberSeasonGroup, orderMembersInGroup } from '../shared/utils/member-season-group'

describe('按赛季展示成员', () => {
  it('参加和担任顾问的赛季重叠时展示在原组别，只有顾问的赛季展示在顾问组', () => {
    const member = { type: '顾问', group: '机械组', time: '26', advisor: '26,27' }
    expect(memberSeasonGroup(member, '26', ['机械组'])).toBe('group:机械组')
    expect(memberSeasonGroup(member, '27', ['机械组'])).toBe('advisors')
    expect(memberSeasonGroup(member, 'all', ['机械组'])).toBe('group:机械组')
  })

  it('队长和没有组别的顾问不会产生团队负责人栏目', () => {
    expect(memberSeasonGroup({ type: '团队负责人', group: '控制组', time: '25' }, '25', ['控制组']))
      .toBe('group:控制组')
    expect(memberSeasonGroup({ type: '团队负责人', time: '25' }, '25', [])).toBe('others')
    expect(memberSeasonGroup({ type: '顾问', advisor: '27' }, '27', [])).toBe('advisors')
  })

  it('指导老师始终展示在指导老师分组', () => {
    expect(memberSeasonGroup({ type: '指导老师', time: '27' }, '27', ['机械组'])).toBe('teachers')
  })

  it('各组按队长、副队长、会长、组长、组员排序，兼任按最高职务排序', () => {
    const members = [
      { name: '组员甲', positions: ['成员'] },
      { name: '副队长', positions: ['副队长', '组长'] },
      { name: '组长', positions: ['组长'] },
      { name: '会长', positions: ['机电创新学会会长'] },
      { name: '队长', positions: ['队长', '成员'] },
      { name: '组员乙', positions: ['成员'] }
    ]
    expect(orderMembersInGroup(members).map(member => member.name))
      .toEqual(['队长', '副队长', '会长', '组长', '组员甲', '组员乙'])
  })
})
