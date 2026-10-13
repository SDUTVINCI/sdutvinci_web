import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDatabase, closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { members, memberProposals, memberRevisions, contentExportJobs } from '../server/db/schema'
import { createCmsMember, submitCmsMemberProfile, submitCmsMemberRestore, applyMemberProposal, getCmsMember, updateCmsMember } from '../server/services/cms-members'
import { bootstrapCmsAdmin, authenticateCmsUser } from '../server/services/cms-auth'
import { submitAccountRegistration, reviewAccountRegistration } from '../server/services/account-registrations'
import { submitOwnMemberProfile, rejectMemberProfileProposal, cleanupUnusedMemberProfileUploads } from '../server/services/member-self-profile'
import { memberTeacherDetails, serializeMemberProfile, memberProfileFromMarkdown, profileFromRecord } from '../server/services/member-profile'
import { batchReviewMemberRequests } from '../server/services/cms-member-batch-review'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
integration('统一成员审核与老师补充信息', () => {
  beforeAll(async () => { process.env.CMS_AUTH_SECRET ??= 'test-member-review-secret-with-at-least-32'; await runMigrations() })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table account_registration_applications, member_profile_uploads, member_proposals, content_export_jobs, audit_logs, sessions, user_members, user_roles, member_revisions, members, users restart identity cascade`)
  })
  afterAll(closeDatabase)
  const setup = async () => {
    const admin = (await bootstrapCmsAdmin({ account: 'reviewadmin', password: 'ReviewAdminPassword123!' }))!
    const member = (await createCmsMember({ memberKey: 'regularone', name: '正式成员', grade: '2025', positions: ['成员'], seasons: ['25'], avatarUrl: 'https://example.com/old.webp' }, admin.id))!
    return { admin, member }
  }
  it('管理员修改别人也只创建申请，批量通过后才更新资料与 Revision', async () => {
    const { admin, member } = await setup()
    const before = await getDatabase().select().from(contentExportJobs)
    const proposal = await submitCmsMemberProfile(member.id, { name: '审核后的姓名', body: '新简介', expectedVersion: member.version }, admin.id)
    expect(await getCmsMember(member.id)).toMatchObject({ name: '正式成员', body: '', version: 1 })
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(before.length)
    const results = await batchReviewMemberRequests('proposal', 'approve', [{ id: proposal.id, version: 1 }], '已核对', admin.id)
    expect(results[0]?.ok).toBe(true)
    expect(await getCmsMember(member.id)).toMatchObject({ name: '审核后的姓名', body: '新简介', version: 2 })
    expect((await getDatabase().select().from(memberRevisions)).length).toBe(2)
  })
  it('旧老师职称自动带入，修改简介不会清掉职称；老师可以通过申请修改补充信息', async () => {
    const { admin } = await setup()
    const teacher = (await createCmsMember({ memberKey: 'gongjinliang', name: '宫金良', positions: ['指导老师'], seasons: ['27'], teacherDetails: '机械电子工程系，教授，博导', avatarUrl: 'https://example.com/teacher.webp' }, admin.id))!
    await getDatabase().update(members).set({ teacherDetails: null }).where(eq(members.id, teacher.id))
    const registration = await submitAccountRegistration({ memberId: teacher.id, password: 'TeacherPassword123!', ipHash: 'b'.repeat(64) })
    await reviewAccountRegistration(registration.id, 'approve', '', admin.id)
    const user = (await authenticateCmsUser('gongjinliang', 'TeacherPassword123!'))!
    const input = { isLearner: false, name: '宫金良', avatarUrl: teacher.avatarUrl!, grade: '', groupName: '', affiliation: '', positions: ['指导老师'], seasons: ['27'], advisorSeasons: [], links: { github: '', 'home-page': '' }, body: '只修改简介', expectedVersion: 1 }
    expect((await getCmsMember(teacher.id))?.teacherDetails).toBe('机械电子工程系，教授，博导')
    const proposal = await submitOwnMemberProfile(user, input)
    expect(proposal.fieldChanges).not.toHaveProperty('teacherDetails')
    await applyMemberProposal(proposal.id, 1, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect(await getCmsMember(teacher.id)).toMatchObject({ role: '指导老师，机械电子工程系，教授，博导', body: '只修改简介' })
    const next = await submitOwnMemberProfile(user, { ...input, expectedVersion: 2, teacherDetails: '机械工程系，副教授，硕导' })
    await applyMemberProposal(next.id, 2, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect((await getCmsMember(teacher.id))?.role).toBe('指导老师，机械工程系，副教授，硕导')
    expect((await authenticateCmsUser('gongjinliang', 'TeacherPassword123!'))?.roles).toEqual(['member'])
  })
  it('批量部分失败不回滚成功项，失败申请仍待审且可拒绝', async () => {
    const { admin, member } = await setup()
    const other = (await createCmsMember({ memberKey: 'regulartwo', name: '第二成员', positions: ['成员'], seasons: ['25'] }, admin.id))!
    const first = await submitCmsMemberProfile(member.id, { name: '成功项', expectedVersion: 1 }, admin.id)
    const second = await submitCmsMemberProfile(other.id, { name: '失败项', expectedVersion: 1 }, admin.id)
    const results = await batchReviewMemberRequests('proposal', 'approve', [{ id: first.id, version: 1 }, { id: second.id, version: 999 }], '', admin.id)
    expect(results.map(item => item.ok)).toEqual([true, false])
    expect((await getCmsMember(member.id))?.name).toBe('成功项')
    expect((await getCmsMember(other.id))?.name).toBe('第二成员')
    expect((await getDatabase().select().from(memberProposals).where(eq(memberProposals.id, second.id)))[0]?.status).toBe('pending')
    const rejected = await batchReviewMemberRequests('proposal', 'reject', [{ id: second.id }], '需要修改', admin.id)
    expect(rejected[0]?.ok).toBe(true)
  })
  it('批量账号审核依据实际档案分别授予正式成员和学员权限', async () => {
    const { admin, member } = await setup()
    const learner = (await createCmsMember({ memberKey: 'learnerone', name: '学员', isLearner: true, positions: [], seasons: [], grade: '2025' }, admin.id))!
    const requests = await Promise.all([member, learner].map(m => submitAccountRegistration({ memberId: m.id, password: 'MemberPassword123!', ipHash: 'a'.repeat(64) })))
    const results = await batchReviewMemberRequests('registration', 'approve', requests.map(r => ({ id: r.id })), '', admin.id)
    expect(results.every(r => r.ok)).toBe(true)
    expect((await authenticateCmsUser('regularone', 'MemberPassword123!'))?.roles).toEqual(['member'])
    expect((await authenticateCmsUser('learnerone', 'MemberPassword123!'))?.roles).toEqual(['reader'])
    const repeated = await batchReviewMemberRequests('registration', 'approve', [{ id: requests[0]!.id }], '', admin.id)
    expect(repeated[0]?.ok).toBe(false)
  })
  it('稳定 ID 修改直到审核通过才同步关联账号与旧署名', async () => {
    const { admin, member } = await setup()
    const request = await submitAccountRegistration({ memberId: member.id, password: 'MemberPassword123!', ipHash: 'a'.repeat(64) })
    await reviewAccountRegistration(request.id, 'approve', '', admin.id)
    const proposal = await submitCmsMemberProfile(member.id, { memberKey: 'renamedmember', name: member.name, expectedVersion: 1 }, admin.id)
    expect(await authenticateCmsUser('regularone', 'MemberPassword123!')).not.toBeNull()
    await applyMemberProposal(proposal.id, 1, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect(await authenticateCmsUser('regularone', 'MemberPassword123!')).toBeNull()
    expect((await authenticateCmsUser('renamedmember', 'MemberPassword123!'))?.memberId).toBe(member.id)
  })
  it('恢复旧版本也先提交审核，拒绝不会删除已经使用过的头像', async () => {
    const { admin, member } = await setup()
    await updateCmsMember(member.id, { name: '当前名字', avatarUrl: 'https://example.com/new.webp', expectedVersion: 1 }, admin.id)
    const proposal = await submitCmsMemberRestore(member.id, member.currentRevisionId!, 2, admin.id)
    expect((await getCmsMember(member.id))?.name).toBe('当前名字')
    await rejectMemberProfileProposal(proposal.id, '暂不恢复', admin.id)
    await cleanupUnusedMemberProfileUploads()
    expect((await getCmsMember(member.id))?.name).toBe('当前名字')
  })
  it('旧 JSON 和 Markdown 可回读，只有明确填写的新字段才扩展导出', () => {
    const old = memberProfileFromMarkdown('---\nid: gongjinliang\nname: 宫金良\nrole: 指导老师，机械电子工程系，教授，博导\ntype: 指导老师\ntime: "27"\n---\n', 'teacher.md')
    expect(memberTeacherDetails(old)).toBe('机械电子工程系，教授，博导')
    expect(serializeMemberProfile(old).source).not.toContain('teacherDetails:')
    const updated = { ...old, teacherDetails: memberTeacherDetails(old) }
    expect(serializeMemberProfile(updated).source).toContain('teacherDetails:')
    expect(memberTeacherDetails(profileFromRecord({ ...old, teacherDetails: undefined }))).toBe('机械电子工程系，教授，博导')
  })
})
