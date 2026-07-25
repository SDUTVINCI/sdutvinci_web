import { randomUUID } from 'node:crypto'
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
      truncate table audit_logs, sessions, user_members, user_roles, members, users
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
      email: 'ADMIN@EXAMPLE.COM',
      displayName: '首位管理员',
      password: 'AdminPassword123'
    })

    expect(admin).toMatchObject({
      email: 'admin@example.com',
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
      email: 'second@example.com',
      displayName: '第二位管理员',
      password: 'OtherPassword123'
    })).rejects.toThrow('CMS_ADMIN_ALREADY_EXISTS')
  })

  it('管理员和普通成员均可登录、创建会话并退出或被停用', async () => {
    const admin = await bootstrapCmsAdmin({
      email: 'admin@example.com',
      displayName: '管理员',
      password: 'AdminPassword123'
    })
    const member = await createCmsUser({
      email: 'member@example.com',
      displayName: '普通成员',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)

    const authenticatedAdmin = await authenticateCmsUser(
      'ADMIN@example.com',
      'AdminPassword123'
    )
    const authenticatedMember = await authenticateCmsUser(
      'member@example.com',
      'MemberPassword123'
    )
    expect(authenticatedAdmin?.roles).toEqual(['admin'])
    expect(authenticatedMember?.roles).toEqual(['member'])
    expect(await authenticateCmsUser('member@example.com', 'wrong')).toBeNull()

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
    expect(await authenticateCmsUser('member@example.com', 'MemberPassword123')).toBeNull()
  })

  it('记录管理员引导、用户创建、登录和资料修改审计事件', async () => {
    const admin = await bootstrapCmsAdmin({
      email: `${randomUUID()}@example.com`,
      displayName: '审计管理员',
      password: 'AdminPassword123'
    })
    const member = await createCmsUser({
      email: `${randomUUID()}@example.com`,
      displayName: '审计成员',
      password: 'MemberPassword123',
      roles: ['member']
    }, admin!.id)
    await createCmsSession(member!, 1, null, 'vitest')
    await updateCmsUser(member!.id, { displayName: '已改名' }, member!.id)

    const events = await getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)

    expect(events.map(event => event.action)).toEqual(expect.arrayContaining([
      'admin.bootstrap',
      'user.create',
      'auth.login',
      'user.update'
    ]))
    expect((await getCmsUser(member!.id))?.displayName).toBe('已改名')
  })
})
