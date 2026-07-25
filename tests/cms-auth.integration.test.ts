import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  authenticateCmsUser,
  bootstrapCmsAdmin,
  countAdmins,
  createCmsSession,
  createCmsUser,
  getCmsSessionUser,
  getCmsUser,
  updateCmsUser
} from '../server/services/cms-auth'
import { verifyCmsPassword } from '../server/utils/cms-security'
import { auditLogs, users } from '../server/db/schema'
import { eq } from 'drizzle-orm'

const hasDatabase = Boolean(process.env.DATABASE_URL)
const integration = hasDatabase ? describe : describe.skip

integration('CMS 身份认证与数据库', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    await runMigrations()
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table audit_logs, sessions, user_members, user_roles, articles, members, users
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
    const admin = await bootstrapCmsAdmin({
      account: 'admin',
      password: 'AdminPassword123'
    })

    expect(admin).toMatchObject({
      account: 'admin',
      roles: ['admin'],
      status: 'active'
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
    expect(await authenticateCmsUser('dongjiahui', 'wrong')).toBeNull()

    const session = await createCmsSession(
      authenticatedMember!,
      1,
      null,
      'vitest'
    )
    expect(await getCmsSessionUser(session.token)).toMatchObject({
      id: member!.id,
      roles: ['member']
    })

    await updateCmsUser(member!.id, { status: 'disabled' }, admin!.id)
    expect(await getCmsSessionUser(session.token)).toBeNull()
    expect(await authenticateCmsUser('dongjiahui', 'MemberPassword123')).toBeNull()
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
})
