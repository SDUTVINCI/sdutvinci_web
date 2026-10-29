import { test } from 'vitest'
import assert from 'node:assert/strict'
import { competitions } from '../app/data/competitions.ts'
import { prepareCompetitions, competitionTimeLeft } from '../app/utils/competitions.ts'

const event = { name: '测试赛事', startsAt: '2027-01-01T09:00:00+08:00', dateStatus: 'confirmed', enabled: true }

test('中期检查与比赛按官方2026赛季同期设置，不能误标正式赛程', () => {
  assert.deepEqual(competitions.map(item => item.name), ['2027 ROBOCON 中期检查', '2027 ROBOCON 比赛'])
  const prepared = prepareCompetitions(competitions)
  assert(prepared.every(item => item.target !== null && item.dateStatus === 'historical' && item.referenceYear === 2026))
  assert.deepEqual(competitions.map(item => item.startsAt), ['2027-04-20T23:59:00+08:00', '2027-07-09T00:00:00+08:00'])
  assert(prepared.every(item => item.sourceUrl.startsWith('https://www.robocon.org.cn/')))
  for (const item of prepared) {
    assert.deepEqual(competitionTimeLeft(item.target, item.target - 1000), { state: 'counting', days: 0, clock: '00:00:01' })
    assert.equal(competitionTimeLeft(item.target, item.target).state, 'reached')
  }
  assert.equal(competitionTimeLeft(null, Date.now()).state, 'pending')
})

test('历史参考必须明确上一赛季年份，转为正式赛程时移除参考标记', () => {
  assert.doesNotThrow(() => prepareCompetitions([{ ...event, dateStatus: 'historical', referenceYear: 2026 }]))
  for (const referenceYear of [undefined, 2025, 2027, '2026', 2026.5]) {
    assert.throws(() => prepareCompetitions([{ ...event, dateStatus: 'historical', referenceYear }]), /referenceYear/)
  }
  assert.throws(() => prepareCompetitions([{ ...event, referenceYear: 2026 }]), /移除参考年份/)
})

test('明确按北京时间解析，错误日期、缺失时区及矛盾状态阻止构建', () => {
  assert.equal(prepareCompetitions([event])[0].target, Date.parse('2027-01-01T01:00:00Z'))
  assert.doesNotThrow(() => prepareCompetitions([{ ...event, startsAt: '2028-02-29T09:00:00+08:00' }]))
  for (const startsAt of [null, '2027-01-01', '2027-01-01T09:00:00', '2027-01-01T09:00:00Z', '2027-02-29T09:00:00+08:00', '2027-02-30T09:00:00+08:00', '2027-01-01T24:00:00+08:00']) {
    assert.throws(() => prepareCompetitions([{ ...event, startsAt }]), /app\/data\/competitions.ts/)
  }
  assert.throws(() => prepareCompetitions([{ ...event, dateStatus: 'pending' }]), /同时更新 dateStatus/)
  assert.throws(() => prepareCompetitions([{ ...event, dateStatus: 'unknown' }]), /日期状态/)
  assert.throws(() => prepareCompetitions([{ ...event, name: ' ' }]), /名称/)
  assert.throws(() => prepareCompetitions([event, event]), /重复/)
  assert.throws(() => prepareCompetitions([{ ...event, enabled: 'false' }]), /enabled/)
})

test('跨日与秒边界倒计时准确，到期后不出现负数', () => {
  const target = prepareCompetitions([event])[0].target
  assert.deepEqual(competitionTimeLeft(target, target - 86400_000 - 3661_000), { state: 'counting', days: 1, clock: '01:01:01' })
  assert.deepEqual(competitionTimeLeft(target, target - 1), { state: 'counting', days: 0, clock: '00:00:01' })
  assert.deepEqual(competitionTimeLeft(target, target), { state: 'reached', days: 0, clock: '00:00:00' })
  assert.deepEqual(competitionTimeLeft(target, target + 86400_000), { state: 'reached', days: 0, clock: '00:00:00' })
  assert.equal(competitionTimeLeft(target, 0).state, 'waiting')
})
