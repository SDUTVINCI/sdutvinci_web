import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { auditLogs, contentExportJobs, members, memberProposals, memberRevisions } from '../server/db/schema'
import { bootstrapCmsAdmin, authenticateCmsUser } from '../server/services/cms-auth'
import { createCmsMember, getCmsMember, updateCmsMember, applyMemberProposal } from '../server/services/cms-members'
import { saveMemberCohort, listMemberOptions } from '../server/services/member-options'
import { submitAccountRegistration, reviewAccountRegistration } from '../server/services/account-registrations'
import { submitOwnMemberProfile, uploadOwnMemberAvatar, withdrawOwnMemberProposal, rejectMemberProfileProposal } from '../server/services/member-self-profile'
import { memberProfileFromMarkdown, serializeMemberProfile } from '../server/services/member-profile'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
integration('学员账号与本人资料审核', () => {
  beforeAll(async () => { process.env.CMS_AUTH_SECRET ??= 'learner-review-test-secret-at-least-32'; await runMigrations() })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table account_registration_applications, member_profile_uploads, member_proposals, content_export_jobs, audit_logs, sessions, user_members, user_roles, member_revisions, members, users restart identity cascade`)
    await saveMemberCohort({ gradeYear: 2026, season: '28', seasonEnabled: false, groups: ['机械组', '软件算法组'], active: true })
  })
  afterAll(closeDatabase)
  const setup = async (isLearner = true, adminOwn = false) => {
    const admin = await bootstrapCmsAdmin({ account: 'reviewadmin', password: 'ReviewAdminPassword123!' })
    const member = await createCmsMember({ memberKey: adminOwn ? 'reviewadmin' : 'learnerone', name: '学员一', avatarUrl: 'https://example.com/old.webp',
      isLearner, grade: '2026', groupName: '机械组', positions: isLearner ? [] : ['成员'], seasons: isLearner ? [] : ['25'], advisorSeasons: [] }, admin!.id)
    if (adminOwn) return { admin: (await authenticateCmsUser('reviewadmin', 'ReviewAdminPassword123!'))!, member: member!, user: (await authenticateCmsUser('reviewadmin', 'ReviewAdminPassword123!'))! }
    const registration = await submitAccountRegistration({ memberId: member!.id, password: 'LearnerPassword123!', ipHash: 'f'.repeat(64) })
    await reviewAccountRegistration(registration.id, 'approve', '', admin!.id)
    return { admin: admin!, member: member!, user: (await authenticateCmsUser('learnerone', 'LearnerPassword123!'))! }
  }
  const inputFor = (member: Awaited<ReturnType<typeof getCmsMember>>) => ({ isLearner: member!.isLearner === true, name: member!.name, avatarUrl: member!.avatarUrl!,
    grade: member!.grade!, groupName: member!.groupName!, positions: [...member!.positions], seasons: [...member!.seasons], advisorSeasons: [...member!.advisorSeasons],
    affiliation: member!.affiliation || '', body: member!.body, links: { github: '', 'home-page': '' }, expectedVersion: member!.version })

  it('2026级可作为学员申请账号，无职务或赛季；导出恢复保留学员身份与组别', async () => {
    const { user, member } = await setup()
    expect(user.roles).toEqual(['reader'])
    expect(member).toMatchObject({ isLearner: true, grade: '2026', positions: [], seasons: [], groupName: '机械组' })
    const revision = (await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.id, member.currentRevisionId!)))[0]!
    const decoded = memberProfileFromMarkdown(revision.markdownSource, 'one.md')
    expect(decoded).toMatchObject({ isLearner: true, groupName: '机械组', positions: [], seasons: [] })
    expect(serializeMemberProfile(decoded).source).toBe(revision.markdownSource)
    const options = await listMemberOptions()
    expect(options.cohorts.some(item => item.gradeYear === 2026)).toBe(true)
    expect(options.seasons).not.toContain('28')
  })

  it('转正申请不改变公开资料、Revision、Outbox和权限；审核通过原子同步角色', async () => {
    const { admin, user, member } = await setup()
    await saveMemberCohort({ gradeYear: 2026, season: '28', seasonEnabled: true, groups: ['机械组'], active: true })
    const jobsBefore = await getDatabase().select().from(contentExportJobs)
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), isLearner: false, positions: ['成员'], seasons: ['28'], body: '申请转正' })
    expect(await getCmsMember(member.id)).toMatchObject({ isLearner: true, body: '', version: 1 })
    expect((await authenticateCmsUser('learnerone', 'LearnerPassword123!'))!.roles).toEqual(['reader'])
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(jobsBefore.length)
    const result = await applyMemberProposal(proposal.id, member.version, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect(result.member).toMatchObject({ isLearner: false, positions: ['成员'], seasons: ['28'], body: '申请转正', version: 2 })
    expect((await authenticateCmsUser('learnerone', 'LearnerPassword123!'))!.roles).toEqual(['member'])
    expect(await getDatabase().select().from(memberRevisions)).toHaveLength(2)
  })

  it('正式成员申请转为学员，审核前保留编辑角色，通过后收回权限', async () => {
    const { admin, user, member } = await setup(false)
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), isLearner: true, positions: [], seasons: [], advisorSeasons: [] })
    expect((await authenticateCmsUser('learnerone', 'LearnerPassword123!'))!.roles).toEqual(['member'])
    await applyMemberProposal(proposal.id, member.version, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect((await authenticateCmsUser('learnerone', 'LearnerPassword123!'))!.roles).toEqual(['reader'])
    expect(await getCmsMember(member.id)).toMatchObject({ isLearner: true, positions: [], seasons: [] })
  })

  it('管理员修改自己的资料也要提交审核，但可以明确审核本人申请', async () => {
    const { user, member } = await setup(false, true)
    await expect(updateCmsMember(member.id, { name: '直接修改', expectedVersion: member.version }, user.id)).rejects.toThrow('MEMBER_SELF_REVIEW_REQUIRED')
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), name: '管理员新姓名' })
    expect((await getCmsMember(member.id))!.name).toBe('学员一')
    await applyMemberProposal(proposal.id, member.version, 'APPLY_MEMBER_PROPOSAL', user.id)
    expect((await getCmsMember(member.id))!.name).toBe('管理员新姓名')
    expect((await authenticateCmsUser('reviewadmin', 'ReviewAdminPassword123!'))!.roles).toEqual(['admin'])
  })

  it('原来没有个人链接时不自动生成空链接或无变化申请', async () => {
    const { user, member } = await setup()
    await expect(submitOwnMemberProfile(user, inputFor(member))).rejects.toThrow('MEMBER_PROFILE_UNCHANGED')
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), body: '只修改简介' })
    expect(Object.keys(proposal.fieldChanges)).toEqual(['body'])
  })

  it('拒绝学员携带职务或虚构头像链接，防止绕过表单', async () => {
    const { user, member } = await setup()
    await expect(submitOwnMemberProfile(user, { ...inputFor(member), positions: ['队长'] })).rejects.toThrow('MEMBER_LEARNER_FIELDS_INVALID')
    await expect(submitOwnMemberProfile(user, { ...inputFor(member), name: '改名', avatarUrl: 'https://example.com/other.webp' })).rejects.toThrow('MEMBER_AVATAR_UPLOAD_INVALID')
  })

  it('原资料并发更新后不能应用旧申请；可撤回重新提交，拒绝不改正式资料', async () => {
    const { admin, user, member } = await setup()
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), body: '本人修改' })
    await expect(submitOwnMemberProfile(user, { ...inputFor(member), body: '重复申请' })).rejects.toThrow('MEMBER_PROFILE_PENDING')
    await updateCmsMember(member.id, { name: '管理员更新', expectedVersion: member.version }, admin.id)
    await expect(applyMemberProposal(proposal.id, 2, 'APPLY_MEMBER_PROPOSAL', admin.id)).rejects.toThrow('成员资料已被其他操作更新')
    await withdrawOwnMemberProposal(user, proposal.id)
    const current = await getCmsMember(member.id)
    const next = await submitOwnMemberProfile(user, { ...inputFor(current), body: '重新提交' })
    await rejectMemberProfileProposal(next.id, '资料需要核对', admin.id)
    expect((await getCmsMember(member.id))!.body).toBe('')
    expect((await getDatabase().select().from(memberProposals).where(eq(memberProposals.id, next.id)))[0]!.reviewNote).toBe('资料需要核对')
  })

  it('停用年级、赛季和旧组别不妨碍保持原历史值的资料修改', async () => {
    const { admin, user, member } = await setup(false)
    await saveMemberCohort({ gradeYear: 2026, season: '28', seasonEnabled: false, groups: ['软件算法组'], active: false })
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), body: '保留历史资料' })
    await applyMemberProposal(proposal.id, member.version, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect(await getCmsMember(member.id)).toMatchObject({ grade: '2026', groupName: '机械组', seasons: ['25'], body: '保留历史资料' })
  })

  it('上传新头像不会更新公开档案，只有提交并审核后生效', async () => {
    const { admin, user, member } = await setup()
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#128789' } }).png().toBuffer()
    const result = await uploadOwnMemberAvatar(user, { expectedVersion: member.version, name: member.name, data: image, mimeType: 'image/png' })
    expect((await getCmsMember(member.id))!.avatarUrl).toBe(member.avatarUrl)
    expect(await getDatabase().select().from(memberRevisions)).toHaveLength(1)
    const proposal = await submitOwnMemberProfile(user, { ...inputFor(member), avatarUrl: result.url })
    expect((await getCmsMember(member.id))!.avatarUrl).toBe(member.avatarUrl)
    await applyMemberProposal(proposal.id, member.version, 'APPLY_MEMBER_PROPOSAL', admin.id)
    expect((await getCmsMember(member.id))!.avatarUrl).toBe(result.url)
    expect((await getDatabase().select().from(auditLogs)).some(log => log.action === 'member.profile.submit')).toBe(true)
  })
})
