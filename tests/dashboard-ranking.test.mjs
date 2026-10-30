import { describe, expect, it } from 'vitest'
import { dashboardCohortRanking } from '../utils/dashboard-members.mjs'
import { dashboardScoreboard } from '../utils/dashboard-data.mjs'

const people = ['甲', '乙', '丙', '丁', '戊'].map((name, index) => ({ key: `p${index}`, name, avatar: '' }))
const tasks = people.map((person, index) => ({ id: `t${index}`, status: 'done', score: [30, 20, 10, 20, 40][index],
  assignees: [person], cohorts: [['老登'], ['小登'], ['老登'], ['小登'], []][index] }))
const rank = (source, cohort, identities = source) => dashboardCohortRanking(dashboardScoreboard(source).rows, identities, cohort)

describe('按飞书账号与成员表查找引用分榜', () => {
  it('总榜包含全部人员，分榜独立排名且同分并列，不修改总榜', () => {
    const rows = dashboardScoreboard(tasks).rows
    const before = structuredClone(rows)
    expect(dashboardCohortRanking(rows, tasks, 'all').rows).toEqual(before)
    expect(rank(tasks, 'senior').rows.map(row => [row.name, row.rank, row.score])).toEqual([['甲', 1, 30], ['丙', 2, 10]])
    expect(rank(tasks, 'junior').rows.map(row => [row.rank, row.score])).toEqual([[1, 20], [1, 20]])
    expect(rank(tasks, 'all').unmatchedCount).toBe(1)
    expect(rows).toEqual(before)
  })
  it('身份随查找引用更新，不依赖网站姓名、年级或赛季', () => {
    const updated = tasks.map(task => ({ ...task, cohorts: ['小登'] }))
    expect(rank(updated, 'senior').rows).toEqual([])
    expect(rank(updated, 'junior').rows).toHaveLength(5)
    const sameName = { ...tasks[0], id: 'duplicate', assignees: [{ key: 'other', name: '甲' }], cohorts: ['小登'] }
    expect(rank([...tasks, sameName], 'senior').rows.map(row => row.key)).toEqual(['p0', 'p2'])
    expect(rank([...tasks, sameName], 'junior').rows[0].key).toBe('other')
  })
  it('冲突、未知、多个标签或缺少账号只列总榜，冲突不被后续有效值覆盖', () => {
    for (const cohorts of [[], ['未知'], ['老登', '小登'], ['小登']]) {
      const conflicting = [...tasks, { ...tasks[0], id: 'conflict', cohorts }, tasks[0]]
      expect(rank(conflicting, 'senior').rows.map(row => row.name)).toEqual(['丙'])
    }
    expect(rank([{ ...tasks[0], assignees: [{ key: '甲', name: '甲' }] }], 'senior').rows).toEqual([])
  })
  it('多人任务不猜测标签对应关系，从其他单人任务确认账号，计分随撤回改分重算', () => {
    const shared = { id: 'shared', status: 'done', score: 12, assignees: people.slice(0, 2), cohorts: ['老登', '小登'] }
    expect(rank([shared], 'senior').rows).toEqual([])
    expect(rank([shared], 'all').unmatchedCount).toBe(2)
    for (const cohort of ['senior', 'junior']) {
      expect(rank([shared], cohort, tasks).rows[0]).toMatchObject({ score: 12, doneCount: 1, rank: 1 })
      expect(rank([{ ...shared, score: 8 }], cohort, tasks).rows[0].score).toBe(8)
      expect(rank([{ ...shared, status: 'review' }], cohort, tasks).rows[0]).toMatchObject({ score: 0, doneCount: 0 })
    }
    expect(rank([], 'senior').rows).toEqual([])
  })
})
