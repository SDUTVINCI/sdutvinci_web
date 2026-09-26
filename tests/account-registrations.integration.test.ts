import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  AccountRegistrationAlreadyRegisteredError,
  AccountRegistrationAccountUnavailableError,
  AccountRegistrationPendingError,
  assertAccountNotReserved,
  listAccountRegistrationMembers,
  listPendingAccountRegistrations,
  reviewAccountRegistration,
  submitAccountRegistration
} from '../server/services/account-registrations'
import {
  authenticateCmsUser,
  bootstrapCmsAdmin,
  createCmsUser
} from '../server/services/cms-auth'
import { createCmsMember, updateCmsMember } from '../server/services/cms-members'
import { verifyCmsPassword } from '../server/utils/cms-security'
import {
  accountRegistrationApplications,
  auditLogs,
  roles,
  userMembers,
  userRoles,
  users
} from '../server/db/schema'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

integration('成员账号注册申请', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'account-registration-test-secret-32'
    await runMigrations()
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table account_registration_applications, content_export_jobs,
        audit_logs, sessions, user_members, user_roles, member_revisions,
        members, users restart identity cascade
    `)
  })

  afterAll(closeDatabase)

  const createMember = async (memberKey: string, name: string, actorUserId: string) =>
    createCmsMember({
      memberKey,
      name,
      sourcePath: `tests/${memberKey}.md`,
      groupName: '软件算法组',
      positions: ['成员'],
      seasons: ['25'],
      grade: '2025'
    }, actorUserId)

  it('匿名申请只保存 Argon2id 哈希，审核通过后创建普通成员账号并清除申请哈希', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'reviewadmin',
      password: 'ReviewAdminPassword123!'
    })
    const member = await createMember('dongjiahui', '董家辉', admin!.id)
    const options = await listAccountRegistrationMembers()
    expect(options.find(item => item.id === member!.id)).toMatchObject({
      account: 'dongjiahui',
      registrationStatus: 'available'
    })

    const submitted = await submitAccountRegistration({
      memberId: member!.id,
      password: 'MemberPassword123!',
      ipHash: 'a'.repeat(64)
    })
    expect(submitted).toMatchObject({ account: 'dongjiahui', status: 'pending' })
    expect(await authenticateCmsUser('dongjiahui', 'MemberPassword123!')).toBeNull()
    const [pending] = await getDatabase().select().from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.id, submitted.id))
    expect(pending?.passwordHash?.startsWith('$argon2id$')).toBe(true)
    expect(await verifyCmsPassword(pending!.passwordHash!, 'MemberPassword123!')).toBe(true)
    expect(await listPendingAccountRegistrations()).toEqual([
      expect.objectContaining({
        id: submitted.id,
        account: 'dongjiahui',
        member: expect.objectContaining({ name: '董家辉' })
      })
    ])

    const approved = await reviewAccountRegistration(
      submitted.id,
      'approve',
      '身份核对通过',
      admin!.id
    )
    expect(approved).toMatchObject({ status: 'approved', account: 'dongjiahui' })
    expect(await authenticateCmsUser('dongjiahui', 'MemberPassword123!')).toMatchObject({
      roles: ['member'],
      memberId: member!.id
    })
    const [reviewed] = await getDatabase().select().from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.id, submitted.id))
    expect(reviewed).toMatchObject({
      status: 'approved',
      passwordHash: null,
      reviewNote: '身份核对通过',
      approvedUserId: approved.userId
    })
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id))).toHaveLength(1)
    const assignedRoles = await getDatabase().select({ code: roles.code })
      .from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, approved.userId))
    expect(assignedRoles.map(item => item.code)).toEqual(['member'])
    expect(JSON.stringify(await getDatabase().select().from(auditLogs)))
      .not.toContain('MemberPassword123!')
  })

  it('账号必须等于档案稳定 ID；ID 被占用时明确拒绝', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'allocateadmin',
      password: 'AllocateAdminPassword123!'
    })
    const first = await createMember('tongming', '同名', admin!.id)
    const second = await createMember('tongming2', '同名二', admin!.id)
    const [occupied] = await getDatabase().insert(users).values({
      account: 'tongming',
      passwordHash: 'test-only-unused-hash'
    }).returning({ id: users.id })
    await getDatabase().insert(userRoles).values({
      userId: occupied!.id,
      roleId: (await getDatabase().select({ id: roles.id }).from(roles)
        .where(eq(roles.code, 'member')).limit(1))[0]!.id
    })
    await expect(submitAccountRegistration({
      memberId: first!.id,
      password: 'FirstMemberPassword123!',
      ipHash: null
    })).rejects.toBeInstanceOf(AccountRegistrationAccountUnavailableError)
    const secondApplication = await submitAccountRegistration({
      memberId: second!.id,
      password: 'SecondMemberPassword123!',
      ipHash: null
    })
    expect((await listAccountRegistrationMembers()).find(item => item.id === first!.id))
      .toMatchObject({ account: 'tongming', registrationStatus: 'unavailable' })
    expect(secondApplication.account).toBe('tongming2')
    await expect(getDatabase().transaction(tx =>
      assertAccountNotReserved(tx, 'tongming2')
    )).rejects.toBeInstanceOf(AccountRegistrationPendingError)
    await expect(createCmsUser({
      account: 'tongming2',
      password: 'AdminCreatedPassword123!',
      roles: ['member']
    }, admin!.id)).rejects.toBeInstanceOf(AccountRegistrationPendingError)
  })

  it('同一成员不能重复申请，已注册成员会给出明确冲突', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'duplicateadmin',
      password: 'DuplicateAdminPassword123!'
    })
    const member = await createMember('duplicatemember', '重复成员', admin!.id)
    const application = await submitAccountRegistration({
      memberId: member!.id,
      password: 'DuplicateMemberPassword123!',
      ipHash: null
    })
    await expect(submitAccountRegistration({
      memberId: member!.id,
      password: 'AnotherPassword123!',
      ipHash: null
    })).rejects.toBeInstanceOf(AccountRegistrationPendingError)
    await reviewAccountRegistration(application.id, 'approve', '', admin!.id)
    await expect(submitAccountRegistration({
      memberId: member!.id,
      password: 'AnotherPassword123!',
      ipHash: null
    })).rejects.toBeInstanceOf(AccountRegistrationAlreadyRegisteredError)
    expect((await listAccountRegistrationMembers()).find(item => item.id === member!.id))
      .toMatchObject({ account: 'duplicatemember', registrationStatus: 'registered' })
  })

  it('待审核期间修改档案稳定 ID 会同步申请账号 ID', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'renameadmin', password: 'RenameAdminPassword123!' })
    const member = await createMember('oldregistration', '改名成员', admin!.id)
    const application = await submitAccountRegistration({
      memberId: member!.id, password: 'RenameMemberPassword123!', ipHash: null
    })
    await updateCmsMember(member!.id, {
      memberKey: 'newregistration', name: '改名成员', expectedVersion: member!.version
    }, admin!.id)
    expect((await getDatabase().select().from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.id, application.id)))[0]?.account).toBe('newregistration')
    expect(await reviewAccountRegistration(application.id, 'approve', '', admin!.id))
      .toMatchObject({ account: 'newregistration' })
  })

  it('拒绝申请后清除密码哈希，并允许成员重新提交', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'rejectadmin',
      password: 'RejectAdminPassword123!'
    })
    const member = await createMember('rejectedmember', '拒绝测试', admin!.id)
    const first = await submitAccountRegistration({
      memberId: member!.id,
      password: 'RejectedMemberPassword123!',
      ipHash: null
    })
    await reviewAccountRegistration(first.id, 'reject', '无法确认身份', admin!.id)
    const [rejected] = await getDatabase().select().from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.id, first.id))
    expect(rejected).toMatchObject({
      status: 'rejected',
      passwordHash: null,
      reviewNote: '无法确认身份'
    })
    await expect(submitAccountRegistration({
      memberId: member!.id,
      password: 'ResubmittedPassword123!',
      ipHash: null
    })).resolves.toMatchObject({ account: 'rejectedmember', status: 'pending' })
  })
})
