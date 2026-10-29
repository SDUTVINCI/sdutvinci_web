import { describe, expect, it } from 'vitest'
import { dashboardCohortRanking } from '../utils/dashboard-members.mjs'
import { dashboardScoreboard } from '../utils/dashboard-data.mjs'

const people = ['老甲', '小甲', '老乙', '小乙', '往届', '未知'].map((name, index) => ({ key: `p${index}`, name, avatar: '' }))
const tasks = people.map((person, index) => ({ id: `t${index}`, status: 'done', score: [30, 20, 10, 20, 50, 40][index], assignees: [person] }))
const members = people.slice(0, 5).map((person, index) => ({ name: person.name, grade: ['2025', '2026', '2025级', '2026', '2024'][index] }))
const rank = (rows, cohort, season = 2027, profiles = members) => dashboardCohortRanking(rows, profiles, season, cohort)

describe('按成员 grade 切换个人积分榜', () => {
  it('总榜包含所有年级和未关联人员，两个年级榜仅包含指定入学年级', () => {
    const { rows } = dashboardScoreboard(tasks)
    expect(rank(rows, 'all').rows).toEqual(rows)
    expect(rank(rows, 'senior').rows.map(row => row.name)).toEqual(['老甲', '老乙'])
    expect(rank(rows, 'junior').rows.map(row => row.name)).toEqual(['小甲', '小乙'])
    expect(rank(rows, 'senior').grade).toBe(2025)
    expect(rank(rows, 'junior').grade).toBe(2026)
    expect(rank(rows, 'all').unmatchedCount).toBe(1)
  })

  it('各榜重新排名，同分并列，来回切换不改变总榜或积分', () => {
    const { rows } = dashboardScoreboard(tasks)
    const before = structuredClone(rows)
    expect(rank(rows, 'senior').rows.map(row => [row.rank, row.score])).toEqual([[1, 30], [2, 10]])
    expect(rank(rows, 'junior').rows.map(row => [row.rank, row.score])).toEqual([[1, 20], [1, 20]])
    expect(rank(rows, 'all').rows).toEqual(before)
    expect(rows).toEqual(before)
  })

  it('随配置赛季调整目标年级，不按成员的参赛年份推断', () => {
    const { rows } = dashboardScoreboard(tasks)
    expect(rank(rows, 'senior', 2028).rows.map(row => row.name)).toEqual(['小甲', '小乙'])
    expect(rank(rows, 'junior', 2028).rows).toEqual([])
    expect(rank(rows, 'senior', 2027, [{ name: '老甲', time: '2025', grade: null }]).rows).toEqual([])
  })

  it('缺失、无效和重名档案只进总榜，不猜测年级', () => {
    const { rows } = dashboardScoreboard(tasks)
    const profiles = [
      { name: '老甲', grade: '2025' }, { name: '老甲', grade: '2026' },
      { name: '小甲', grade: '26' }, { name: '老乙', grade: '2025/2026' },
      { name: '小乙', grade: '' }, { name: '往届', grade: null }
    ]
    expect(rank(rows, 'senior', 2027, profiles).rows).toEqual([])
    expect(rank(rows, 'junior', 2027, profiles).rows).toEqual([])
    expect(rank(rows, 'all', 2027, profiles).unmatchedCount).toBe(6)
    expect(rank(rows, 'all', 2027, []).rows).toEqual(rows)
  })

  it('不同飞书 ID 同名时不把同一个档案年级分给两个人', () => {
    const { rows } = dashboardScoreboard([...tasks, { id: 'duplicate', status: 'done', score: 5, assignees: [{ key: 'other', name: '老甲' }] }])
    expect(rank(rows, 'senior').rows.map(row => row.name)).toEqual(['老乙'])
    expect(rank(rows, 'all').rows).toHaveLength(7)
    expect(rank(rows, 'all').unmatchedCount).toBe(3)
  })

  it('继续沿用当前组别计分、多人全分、完成撤回和改分重算的规则', () => {
    const shared = { id: 'shared', status: 'done', score: 12, assignees: people.slice(0, 2) }
    const ranked = task => dashboardScoreboard([task]).rows
    for (const cohort of ['senior', 'junior']) {
      expect(rank(ranked(shared), cohort).rows[0]).toMatchObject({ score: 12, doneCount: 1, rank: 1 })
      expect(rank(ranked({ ...shared, score: 8 }), cohort).rows[0].score).toBe(8)
      expect(rank(ranked({ ...shared, status: 'todo' }), cohort).rows[0]).toMatchObject({ score: 0, doneCount: 0 })
    }
    expect(rank([], 'senior').rows).toEqual([])
  })
})
