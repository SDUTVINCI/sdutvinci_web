import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { cmsReviewHistory, drafts, memberApplications, memberProposals, members, users } from '../server/db/schema'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import { createCmsMember, submitCmsMemberProfile } from '../server/services/cms-members'
import { reviewMemberApplication } from '../server/services/member-applications'
import { submitAccountRegistration, reviewAccountRegistration } from '../server/services/account-registrations'
import { approveCmsDraftReview, rejectCmsDraftReview } from '../server/services/cms-reviews'
import { publishCmsDraft } from '../server/services/cms-publishing'
import { batchReviewMemberRequests } from '../server/services/cms-member-batch-review'
import { getReviewHistoryDetail, listReviewHistory } from '../server/services/cms-review-history'
import { resetCmsV2FlagsForTests } from '../server/utils/cms-v2-flags'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
integration('统一审核历史', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-review-history-secret-at-least-32-characters'
    process.env.CONTENT_PUBLISH_MODE = 'database'
    resetCmsV2FlagsForTests()
    await runMigrations()
  })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table users, members, drafts, member_applications, member_proposals, cms_review_history restart identity cascade`)
  })
  afterAll(closeDatabase)
  const admin = () => bootstrapCmsAdmin({ account: 'historyadmin', password: 'HistoryAdminPassword123!' }).then(user => user!)
  const member = (actor: string, key = 'historymember') => createCmsMember({ memberKey: key, name: '历史成员', grade: '2025', positions: ['成员'], seasons: ['25'], body: '修改前简介' }, actor).then(row => row!)
  const application = async () => {
    const [row] = await getDatabase().insert(memberApplications).values({
      accessTokenHash: randomUUID().replaceAll('-', '').repeat(2), status: 'submitted',
      profile: { name: '申请成员', grade: '2025', positions: ['成员'], seasons: ['25'], body: '申请简介' },
      submittedAt: new Date(), expiresAt: new Date(Date.now() + 86400000)
    }).returning()
    return row!
  }
  const draft = async (actor: string, title = '历史文章') => {
    const [row] = await getDatabase().insert(drafts).values({ ownerUserId: actor, collection: 'news', title, body: '审核时正文', status: 'pending_review' }).returning()
    return row!
  }

  it('文章通过和发布分别留档，重审产生新事件，记录保留当时正文与审核人', async () => {
    const actor = await admin()
    const article = await draft(actor.id)
    await approveCmsDraftReview(article.id, actor.id, 1)
    await publishCmsDraft(article.id, actor.id, { version: 2, relativePath: '2026-10-27-history.md' })
    const history = await listReviewHistory({ page: 1, pageSize: 25 })
    expect(history.items.map(item => item.action).sort()).toEqual(['approved', 'published'])
    const approved = history.items.find(item => item.action === 'approved')!
    await getDatabase().update(drafts).set({ title: '后来改名', body: '后来的正文' }).where(eq(drafts.id, article.id))
    await getDatabase().update(users).set({ account: 'renamedadmin' }).where(eq(users.id, actor.id))
    const detail = (await getReviewHistoryDetail(approved.id))!
    expect(detail.entry).toMatchObject({ title: '历史文章', actorLabel: 'historyadmin（@historyadmin）', legacy: false })
    expect(detail.changes).toContainEqual({ field: '正文 / 简介', before: '未填写', after: '审核时正文' })
    expect(detail.entry).not.toHaveProperty('snapshot')
    await getDatabase().update(drafts).set({ status: 'pending_review', version: 4 }).where(eq(drafts.id, article.id))
    await rejectCmsDraftReview(article.id, actor.id, { version: 4, reason: '正文需补充' })
    expect((await listReviewHistory({ page: 1, pageSize: 25, action: 'rejected' })).items[0]?.note).toBe('正文需补充')
  })

  it('新成员审核去重，删除原申请后历史和内容仍保留', async () => {
    const actor = await admin()
    const pending = await application()
    await reviewMemberApplication(pending.id, 'approve', '资料核对通过', actor.id)
    await reviewMemberApplication(pending.id, 'approve', '', actor.id)
    const history = await listReviewHistory({ page: 1, pageSize: 25, kind: 'member_application' })
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({ title: '申请成员', submitterLabel: '匿名申请', note: '资料核对通过' })
    await getDatabase().delete(memberApplications).where(eq(memberApplications.id, pending.id))
    expect((await getReviewHistoryDetail(history.items[0]!.id))?.changes).toContainEqual({ field: '姓名', before: '未填写', after: '申请成员' })
  })

  it('账号注册历史不保存密码、哈希或会话信息', async () => {
    const actor = await admin()
    const profile = await member(actor.id)
    const registration = await submitAccountRegistration({ memberId: profile.id, password: 'RegistrationPassword123!', ipHash: 'a'.repeat(64) })
    await reviewAccountRegistration(registration.id, 'approve', '身份核对通过', actor.id)
    const history = await listReviewHistory({ page: 1, pageSize: 25, kind: 'account_registration' })
    expect(history.items[0]).toMatchObject({ title: '历史成员 · @historymember', note: '身份核对通过' })
    const detail = await getReviewHistoryDetail(history.items[0]!.id)
    const stored = await getDatabase().select().from(cmsReviewHistory)
    for (const json of [JSON.stringify(detail), JSON.stringify(stored)]) {
      expect(json).not.toMatch(/password|argon2|ipHash|RegistrationPassword|accessToken/i)
    }
    expect(detail?.changes).toContainEqual({ field: '账号', before: '未填写', after: 'historymember' })
  })

  it('批量审核逐项留档，成功与失败共用批次，但失败不记成驳回', async () => {
    const actor = await admin()
    const first = await member(actor.id)
    const second = await member(actor.id, 'secondmember')
    const one = await submitCmsMemberProfile(first.id, { name: '已通过姓名', expectedVersion: 1 }, actor.id)
    const two = await submitCmsMemberProfile(second.id, { body: '新的简介', expectedVersion: 1 }, actor.id)
    const results = await batchReviewMemberRequests('proposal', 'approve', [{ id: one.id, version: 1 }, { id: two.id, version: 999 }], '已核对', actor.id)
    expect(results.map(result => result.ok)).toEqual([true, false])
    const history = await listReviewHistory({ page: 1, pageSize: 25, kind: 'member_profile' })
    expect(history.items.map(item => item.action).sort()).toEqual(['approved', 'failed'])
    expect(history.items[0]!.batchId).toBeTruthy()
    expect(new Set(history.items.map(item => item.batchId)).size).toBe(1)
    expect((await listReviewHistory({ page: 1, pageSize: 25, batch: history.items[0]!.batchId! })).total).toBe(2)
    expect((await getDatabase().select().from(memberProposals).where(eq(memberProposals.id, two.id)))[0]?.status).toBe('pending')
    expect(JSON.stringify(history)).not.toMatch(/insert into|select .*from|params:|23505/i)
  })

  it('历史写入失败时，审核结果与成员创建一起回滚，重试可恢复', async () => {
    const actor = await admin()
    const pending = await application()
    await getDatabase().execute(sql`create function vinci_history_fail() returns trigger language plpgsql as $$
      begin if NEW.action = 'approved' then raise exception 'HISTORY_TEST_FAILURE'; end if; return NEW; end $$;
      create trigger vinci_history_fail before insert on cms_review_history for each row execute function vinci_history_fail()`)
    try {
      await expect(reviewMemberApplication(pending.id, 'approve', '', actor.id)).rejects.toThrow()
      expect(await getDatabase().select().from(members)).toHaveLength(0)
      expect((await getDatabase().select().from(memberApplications))[0]?.status).toBe('submitted')
      expect((await listReviewHistory({ page: 1, pageSize: 25 })).items.map(item => item.action)).toEqual(['failed'])
    } finally {
      await getDatabase().execute(sql`drop trigger vinci_history_fail on cms_review_history; drop function vinci_history_fail()`)
    }
    await reviewMemberApplication(pending.id, 'approve', '', actor.id)
    expect((await listReviewHistory({ page: 1, pageSize: 25, action: 'approved' })).total).toBe(1)
  })

  it('按类型、结果、审核人、日期、关键词与批次筛选，分页排序稳定', async () => {
    const actor = await admin()
    for (const title of ['100%通过', '其他文章', '相同时间文章']) {
      const row = await draft(actor.id, title)
      await approveCmsDraftReview(row.id, actor.id, 1)
    }
    await getDatabase().update(cmsReviewHistory).set({ createdAt: new Date('2026-10-27T01:00:00Z') })
    const input = { page: 1, pageSize: 2, kind: 'article' as const, action: 'approved' as const, reviewer: actor.id, from: new Date('2026-10-26T16:00:00Z'), until: new Date('2026-10-27T16:00:00Z') }
    const first = await listReviewHistory(input)
    const second = await listReviewHistory({ ...input, page: 2 })
    expect(first.total).toBe(3)
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(3)
    expect((await listReviewHistory({ page: 1, pageSize: 25, query: '%' })).items.map(item => item.title)).toEqual(['100%通过'])
    expect((await listReviewHistory({ ...input, until: new Date('2026-10-27T01:00:00Z') })).total).toBe(0)
    expect(first.reviewers).toEqual([{ id: actor.id, label: 'historyadmin（@historyadmin）' }])
    expect(await getReviewHistoryDetail(randomUUID())).toBeNull()
  })

  it('已有文章、成员、资料提案和账号历史可幂等补录，缺失信息不伪造', async () => {
    const actor = await admin()
    const pending = await application()
    await reviewMemberApplication(pending.id, 'approve', '旧成员申请', actor.id)
    const profile = await member(actor.id)
    const proposal = await submitCmsMemberProfile(profile.id, { body: '旧资料修改', expectedVersion: 1 }, actor.id)
    await batchReviewMemberRequests('proposal', 'reject', [{ id: proposal.id }], '旧驳回意见', actor.id)
    const registration = await submitAccountRegistration({ memberId: profile.id, password: 'RegistrationPassword123!', ipHash: 'b'.repeat(64) })
    await reviewAccountRegistration(registration.id, 'reject', '旧账号驳回', actor.id)
    const article = await draft(actor.id)
    await approveCmsDraftReview(article.id, actor.id, 1)
    await publishCmsDraft(article.id, actor.id, { version: 2, relativePath: '2026-10-27-legacy-history.md' })
    const expected = (await listReviewHistory({ page: 1, pageSize: 25 })).total
    await getDatabase().delete(cmsReviewHistory)
    await getDatabase().update(memberApplications).set({ reviewedByUserId: null }).where(eq(memberApplications.id, pending.id))
    const migration = await readFile('server/db/migrations/0032_cms_review_history.sql', 'utf8')
    const backfill = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION pg_temp.cms_history_label'))
    for (let pass = 0; pass < 2; pass++) await getDatabase().transaction(async tx => { await tx.execute(sql.raw(backfill.replaceAll('--> statement-breakpoint', ''))) })
    const history = await listReviewHistory({ page: 1, pageSize: 25 })
    expect(history.total).toBe(expected)
    expect(history.items.every(item => item.legacy)).toBe(true)
    const oldApplication = history.items.find(item => item.kind === 'member_application')!
    expect(oldApplication.actorLabel).toBe('历史记录未保存')
    expect((await getReviewHistoryDetail(oldApplication.id))?.changes).toEqual([])
    expect(JSON.stringify(await getDatabase().select().from(cmsReviewHistory))).not.toMatch(/password|argon2|RegistrationPassword/i)
  })
})
