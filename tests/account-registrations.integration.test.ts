import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  createCmsUser,
  deleteCmsUser
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

  it('删除账号后保留旧记录，并允许同一档案重新申请和注册同 ID 账号', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'reregisteradmin',
      password: 'ReregisterAdminPassword123!'
    })
    const member = await createMember('duanquanyu', '段泉宇', admin!.id)
    const oldUser = await createCmsUser({
      account: 'duanquanyu',
      password: 'OldDuanPassword123!',
      roles: ['member']
    }, admin!.id)
    expect((await listAccountRegistrationMembers()).find(item => item.id === member!.id))
      .toMatchObject({ registrationStatus: 'registered' })

    await deleteCmsUser(oldUser!.id, admin!.id)
    expect((await listAccountRegistrationMembers()).find(item => item.id === member!.id))
      .toMatchObject({ account: 'duanquanyu', registrationStatus: 'available' })
    const application = await submitAccountRegistration({
      memberId: member!.id,
      password: 'NewDuanPassword123!',
      ipHash: null
    })
    const approved = await reviewAccountRegistration(application.id, 'approve', '', admin!.id)
    expect(approved).toMatchObject({ status: 'approved', account: 'duanquanyu' })
    expect(approved.userId).not.toBe(oldUser!.id)
    expect((await getDatabase().select().from(users).where(eq(users.account, 'duanquanyu'))))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: oldUser!.id, status: 'disabled', deletedAt: expect.any(Date) }),
        expect.objectContaining({ id: approved.userId, status: 'active', deletedAt: null })
      ]))
    expect(await authenticateCmsUser('duanquanyu', 'OldDuanPassword123!')).toBeNull()
    expect(await authenticateCmsUser('duanquanyu', 'NewDuanPassword123!'))
      .toMatchObject({ id: approved.userId, memberId: member!.id })
  })

  it('历史删除账号遗留成员关联时，列表、提交和审核仍允许重新注册', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'staleadmin', password: 'StaleAdminPassword123!'
    })
    const member = await createMember('staleprofile', '旧关联成员', admin!.id)
    const oldUser = await createCmsUser({
      account: 'staleprofile', password: 'OldProfilePassword123!', roles: ['member']
    }, admin!.id)
    await getDatabase().update(users).set({ deletedAt: new Date(), status: 'disabled' })
      .where(eq(users.id, oldUser!.id))
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id))).toHaveLength(1)
    expect((await listAccountRegistrationMembers()).find(item => item.id === member!.id))
      .toMatchObject({ account: 'staleprofile', registrationStatus: 'available' })

    const application = await submitAccountRegistration({
      memberId: member!.id, password: 'NewProfilePassword123!', ipHash: null
    })
    expect(application).toMatchObject({ account: 'staleprofile', status: 'pending' })
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id))).toHaveLength(0)

    const [anotherDeletedUser] = await getDatabase().insert(users).values({
      account: 'oldstaleprofile', passwordHash: 'test-only-unused-hash',
      status: 'disabled', deletedAt: new Date()
    }).returning({ id: users.id })
    await getDatabase().insert(userMembers).values({
      userId: anotherDeletedUser!.id, memberId: member!.id
    })
    const approved = await reviewAccountRegistration(application.id, 'approve', '', admin!.id)
    expect(approved).toMatchObject({ status: 'approved', account: 'staleprofile' })
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id)))
      .toEqual([expect.objectContaining({ userId: approved.userId })])
  })

  it('管理员新建同 ID 账号时清除已删除账号遗留的关联', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'recreateadmin', password: 'RecreateAdminPassword123!'
    })
    const member = await createMember('recreateprofile', '重建账号成员', admin!.id)
    const oldUser = await createCmsUser({
      account: 'recreateprofile', password: 'OldRecreatePassword123!', roles: ['member']
    }, admin!.id)
    await getDatabase().update(users).set({ deletedAt: new Date(), status: 'disabled' })
      .where(eq(users.id, oldUser!.id))

    const newUser = await createCmsUser({
      account: 'recreateprofile', password: 'NewRecreatePassword123!', roles: ['member']
    }, admin!.id)
    expect(newUser).toMatchObject({ memberId: member!.id })
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id)))
      .toEqual([expect.objectContaining({ userId: newUser!.id })])
  })

  it('修改稳定 ID 时不更名已删除账号，也不保留其旧关联', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'stalekeyadmin', password: 'StaleKeyAdminPassword123!'
    })
    const member = await createMember('oldprofilekey', '改名成员', admin!.id)
    const oldUser = await createCmsUser({
      account: 'oldprofilekey', password: 'OldKeyPassword123!', roles: ['member']
    }, admin!.id)
    await getDatabase().update(users).set({ deletedAt: new Date(), status: 'disabled' })
      .where(eq(users.id, oldUser!.id))

    await updateCmsMember(member!.id, {
      memberKey: 'newprofilekey', name: '改名成员', expectedVersion: member!.version
    }, admin!.id)
    expect((await getDatabase().select({ account: users.account }).from(users)
      .where(eq(users.id, oldUser!.id)))[0]?.account).toBe('oldprofilekey')
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, member!.id))).toHaveLength(0)
    expect((await listAccountRegistrationMembers()).find(item => item.id === member!.id))
      .toMatchObject({ account: 'newprofilekey', registrationStatus: 'available' })
  })

  it('数据迁移只清理已删除账号的成员关联，保留有效关联', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'migrationadmin', password: 'MigrationAdminPassword123!'
    })
    const staleMember = await createMember('stalehistory', '历史关联', admin!.id)
    const activeMember = await createMember('activehistory', '有效关联', admin!.id)
    const staleUser = await createCmsUser({
      account: 'stalehistory', password: 'StaleHistoryPassword123!', roles: ['member']
    }, admin!.id)
    const activeUser = await createCmsUser({
      account: 'activehistory', password: 'ActiveHistoryPassword123!', roles: ['member']
    }, admin!.id)
    await getDatabase().update(users).set({ deletedAt: new Date(), status: 'disabled' })
      .where(eq(users.id, staleUser!.id))

    const migration = await readFile(resolve('server/db/migrations/0028_cleanup_deleted_member_links.sql'), 'utf8')
    await getDatabase().execute(sql.raw(migration))
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, staleMember!.id))).toHaveLength(0)
    expect(await getDatabase().select().from(userMembers)
      .where(eq(userMembers.memberId, activeMember!.id)))
      .toEqual([expect.objectContaining({ userId: activeUser!.id })])
    expect(await getDatabase().select().from(users).where(eq(users.id, staleUser!.id)))
      .toHaveLength(1)
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
