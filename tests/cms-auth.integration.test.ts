import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  authenticateCmsUser,
  bootstrapCmsAdmin,
  changeCmsOwnPassword,
  CmsLastAdminError,
  countAdmins,
  createCmsSession,
  createCmsUser,
  getCmsSessionUser,
  getCmsUser,
  updateCmsUser
} from '../server/services/cms-auth'
import {
  assertCmsLoginAllowed,
  clearCmsLoginFailures,
  CmsRateLimitError,
  consumeCmsMediaUploadLimit,
  recordCmsLoginFailure
} from '../server/services/cms-rate-limits'
import { verifyCmsPassword } from '../server/utils/cms-security'
import {
  auditLogs,
  members,
  rateLimitBuckets,
  userMembers,
  users
} from '../server/db/schema'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

integration('CMS 身份认证与数据库', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    await runMigrations()
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table rate_limit_buckets, article_deletion_events, publish_records, edit_locks, review_events, audit_logs, sessions, draft_authors, article_revisions, drafts, user_members, user_roles, articles, members, users
      restart identity cascade
    `)
  })

  afterAll(closeDatabase)

  it('空库迁移可重复执行并初始化系统角色', async () => {
    const result = await getDatabase().execute(sql`
      select code from roles order by code
    `)
    expect(result.rows.map(row => row.code)).toEqual(['admin', 'member'])
  })

  it('只允许首次引导创建一个管理员，并使用 Argon2id 保存密码', async () => {
    const [adminMember] = await getDatabase().insert(members).values({
      memberKey: 'admin',
      name: '管理员成员',
      avatarUrl: '/images/logo.png',
      sourcePath: 'active/admin.md'
    }).returning({ id: members.id })
    const admin = await bootstrapCmsAdmin({
      account: 'admin',
      password: 'AdminPassword123'
    })

    expect(admin).toMatchObject({
      account: 'admin',
      roles: ['admin'],
      status: 'active',
      memberId: adminMember!.id,
      member: {
        id: adminMember!.id,
        name: '管理员成员'
      }
    })
    expect(await countAdmins()).toBe(1)

    const [stored] = await getDatabase()
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, admin!.id))
    expect(stored?.hash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyCmsPassword(stored!.hash, 'AdminPassword123')).toBe(true)

    await expect(bootstrapCmsAdmin({
      account: 'secondadmin',
      password: 'OtherPassword123'
    })).rejects.toThrow('CMS_ADMIN_ALREADY_EXISTS')
    await expect(updateCmsUser(
      admin!.id,
      { roles: ['member'] },
      admin!.id
    )).rejects.toBeInstanceOf(CmsLastAdminError)
    await expect(updateCmsUser(
      admin!.id,
      { status: 'disabled' },
      admin!.id
    )).rejects.toBeInstanceOf(CmsLastAdminError)
    expect(await countAdmins()).toBe(1)
  })

  it('管理员和普通成员均可登录、创建会话并退出或被停用', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'admin',
      password: 'AdminPassword123'
    })
    const member = await createCmsUser({
      account: 'dongjiahui',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)
    const [memberProfile] = await getDatabase().insert(members).values({
      memberKey: 'dongjiahui',
      name: '董家辉',
      avatarUrl: '/images/team/dongjiahui.jpg',
      sourcePath: 'active/dongjiahui.md'
    }).returning({ id: members.id })
    await getDatabase().insert(userMembers).values({
      userId: member!.id,
      memberId: memberProfile!.id
    })

    const authenticatedAdmin = await authenticateCmsUser(
      'ADMIN',
      'AdminPassword123'
    )
    const authenticatedMember = await authenticateCmsUser(
      'dongjiahui',
      'MemberPassword123'
    )
    expect(authenticatedAdmin?.roles).toEqual(['admin'])
    expect(authenticatedMember?.roles).toEqual(['member'])
    expect(authenticatedMember?.account).toBe('dongjiahui')
    expect(authenticatedMember?.member).toEqual({
      id: memberProfile!.id,
      memberKey: 'dongjiahui',
      name: '董家辉',
      avatarUrl: '/images/team/dongjiahui.jpg'
    })
    expect(await authenticateCmsUser('dongjiahui', 'wrong')).toBeNull()

    const session = await createCmsSession(
      authenticatedMember!,
      1,
      null,
      'vitest'
    )
    expect(await getCmsSessionUser(session.token)).toMatchObject({
      id: member!.id,
      roles: ['member'],
      member: {
        id: memberProfile!.id,
        memberKey: 'dongjiahui',
        name: '董家辉',
        avatarUrl: '/images/team/dongjiahui.jpg'
      }
    })

    await updateCmsUser(member!.id, { status: 'disabled' }, admin!.id)
    expect(await getCmsSessionUser(session.token)).toBeNull()
    expect(await authenticateCmsUser('dongjiahui', 'MemberPassword123')).toBeNull()
  })

  it('创建与成员稳定 ID 相同的账号时自动关联姓名和头像', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'linkadmin',
      password: 'AdminPassword123'
    })
    const [memberProfile] = await getDatabase().insert(members).values({
      memberKey: 'linkedmember',
      name: '已关联成员',
      avatarUrl: '/images/team/linkedmember.jpg',
      sourcePath: 'active/linkedmember.md'
    }).returning({ id: members.id })

    const user = await createCmsUser({
      account: 'linkedmember',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)

    expect(user).toMatchObject({
      memberId: memberProfile!.id,
      member: {
        id: memberProfile!.id,
        memberKey: 'linkedmember',
        name: '已关联成员',
        avatarUrl: '/images/team/linkedmember.jpg'
      }
    })
  })

  it('记录管理员引导、用户创建、登录和用户更新审计事件', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'auditadmin',
      password: 'AdminPassword123'
    })
    const member = await createCmsUser({
      account: 'auditmember',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)
    await createCmsSession(member!, 1, null, 'vitest')
    await updateCmsUser(member!.id, { roles: ['member'] }, admin!.id)

    const events = await getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)

    expect(events.map(event => event.action)).toEqual(expect.arrayContaining([
      'admin.bootstrap',
      'user.create',
      'auth.login',
      'user.update'
    ]))
    expect((await getCmsUser(member!.id))?.roles).toEqual(['member'])
  })

  it('用户改密会验证当前密码并仅保留当前会话，管理员重置会撤销目标全部会话', async () => {
    const admin = await bootstrapCmsAdmin({
      account: 'passwordadmin',
      password: 'AdminPassword123'
    })
    const member = await createCmsUser({
      account: 'passwordmember',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)
    const currentSession = await createCmsSession(member!, 1, null, 'current-device')
    const otherSession = await createCmsSession(member!, 1, null, 'other-device')

    await expect(changeCmsOwnPassword(
      member!.id,
      'WrongCurrentPassword',
      'ChangedPassword123',
      currentSession.token
    )).resolves.toBe(false)
    expect(await authenticateCmsUser(
      'passwordmember',
      'MemberPassword123'
    )).not.toBeNull()

    await expect(changeCmsOwnPassword(
      member!.id,
      'MemberPassword123',
      'ChangedPassword123',
      currentSession.token
    )).resolves.toBe(true)
    expect(await authenticateCmsUser(
      'passwordmember',
      'MemberPassword123'
    )).toBeNull()
    expect(await authenticateCmsUser(
      'passwordmember',
      'ChangedPassword123'
    )).not.toBeNull()
    expect(await getCmsSessionUser(currentSession.token)).not.toBeNull()
    expect(await getCmsSessionUser(otherSession.token)).toBeNull()

    const resetSession = await createCmsSession(member!, 1, null, 'reset-device')
    await updateCmsUser(member!.id, {
      password: 'ResetPassword123'
    }, admin!.id)
    expect(await getCmsSessionUser(currentSession.token)).toBeNull()
    expect(await getCmsSessionUser(resetSession.token)).toBeNull()
    expect(await authenticateCmsUser(
      'passwordmember',
      'ChangedPassword123'
    )).toBeNull()
    expect(await authenticateCmsUser(
      'passwordmember',
      'ResetPassword123'
    )).not.toBeNull()

    const passwordEvents = await getDatabase()
      .select({
        action: auditLogs.action,
        metadata: auditLogs.metadata
      })
      .from(auditLogs)
      .where(inArray(auditLogs.action, [
        'user.password.change',
        'user.update'
      ]))
    expect(passwordEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'user.password.change',
        metadata: { otherSessionsRevoked: true }
      }),
      expect.objectContaining({
        action: 'user.update',
        metadata: { passwordChanged: true }
      })
    ]))
    expect(JSON.stringify(passwordEvents)).not.toContain('ChangedPassword123')
    expect(JSON.stringify(passwordEvents)).not.toContain('ResetPassword123')
  })

  it('按账号持久记录失败并在阈值后锁定，且不保存原始账号', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z')
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await recordCmsLoginFailure('TargetAccount', now)
    }

    await expect(recordCmsLoginFailure('TargetAccount', now))
      .rejects.toBeInstanceOf(CmsRateLimitError)
    await expect(assertCmsLoginAllowed('targetaccount', 'hashed-test-ip', now))
      .rejects.toBeInstanceOf(CmsRateLimitError)

    const buckets = await getDatabase().select().from(rateLimitBuckets)
    const accountBucket = buckets.find(
      bucket => bucket.scope === 'login-account-failure'
    )
    expect(accountBucket).toMatchObject({ attemptCount: 5 })
    expect(accountBucket?.keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(buckets)).not.toContain('targetaccount')

    await clearCmsLoginFailures('TARGETACCOUNT')
    await expect(assertCmsLoginAllowed(
      'targetaccount',
      'hashed-test-ip',
      new Date(now.getTime() + 1000)
    )).resolves.toBeUndefined()
  })

  it('限制单个来源的登录尝试频率', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z')
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await assertCmsLoginAllowed(
        `account-${attempt}`,
        'hashed-shared-test-ip',
        now
      )
    }

    await expect(assertCmsLoginAllowed(
      'account-31',
      'hashed-shared-test-ip',
      now
    )).rejects.toBeInstanceOf(CmsRateLimitError)
  })

  it('限制单个用户的图片上传频率', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z')
    for (let upload = 1; upload <= 20; upload += 1) {
      await consumeCmsMediaUploadLimit('test-user-id', now)
    }

    await expect(consumeCmsMediaUploadLimit('test-user-id', now))
      .rejects.toBeInstanceOf(CmsRateLimitError)
  })
})
