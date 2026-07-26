import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { CmsManagedUser, CmsRoleCode, CmsUser } from '../../shared/types/cms-auth'
import { cmsRoleCodes } from '../../shared/types/cms-auth'
import { getDatabase } from '../db/client'
import {
  auditLogs,
  members,
  roles,
  sessions,
  userMembers,
  userRoles,
  users
} from '../db/schema'
import {
  createSessionToken,
  hashCmsPassword,
  hashSessionToken,
  verifyCmsPassword
} from '../utils/cms-security'

export interface CreateCmsUserInput {
  account: string
  password: string
  roles: CmsRoleCode[]
}

export interface UpdateCmsUserInput {
  status?: 'active' | 'disabled'
  roles?: CmsRoleCode[]
  password?: string
}

export class CmsLastAdminError extends Error {
  constructor() {
    super('不能停用或移除最后一个管理员')
    this.name = 'CmsLastAdminError'
  }
}

const normalizeAccount = (account: string) => account.trim().toLowerCase()
const dummyPasswordHash = [
  '$argon2id$v=19$m=19456,p=1,t=2',
  'gm+RMKrH/megdzjjhUXTIQ',
  'uwt+ea0wTEkE40Yrbi2cMCfyissUZGE+EHecObWu42k'
].join('$')

const uniqueRoleCodes = (values: CmsRoleCode[]) =>
  [...new Set(values)].filter(value => cmsRoleCodes.includes(value))

const loadUserRows = async (userId?: string) => {
  const db = getDatabase()
  const query = db
    .select({
      id: users.id,
      account: users.account,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      role: roles.code,
      memberId: userMembers.memberId,
      memberKey: members.memberKey,
      memberName: members.name,
      memberAvatarUrl: members.avatarUrl
    })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .leftJoin(members, eq(userMembers.memberId, members.id))
    .orderBy(asc(users.createdAt), asc(users.id))

  return userId ? query.where(eq(users.id, userId)) : query
}

const rowsToManagedUsers = (rows: Awaited<ReturnType<typeof loadUserRows>>): CmsManagedUser[] => {
  const result = new Map<string, CmsManagedUser>()

  for (const row of rows) {
    const current = result.get(row.id) ?? {
      id: row.id,
      account: row.account,
      status: row.status,
      roles: [],
      memberId: row.memberId,
      member: row.memberId && row.memberKey && row.memberName
        ? {
            id: row.memberId,
            memberKey: row.memberKey,
            name: row.memberName,
            avatarUrl: row.memberAvatarUrl
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }

    if (row.role && cmsRoleCodes.includes(row.role as CmsRoleCode)) {
      current.roles.push(row.role as CmsRoleCode)
    }

    result.set(row.id, current)
  }

  return [...result.values()]
}

const replaceRoles = async (
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  userId: string,
  roleCodes: CmsRoleCode[]
) => {
  const codes = uniqueRoleCodes(roleCodes)
  const roleRows = await tx
    .select({ id: roles.id, code: roles.code })
    .from(roles)
    .where(inArray(roles.code, codes))

  if (roleRows.length !== codes.length) {
    throw new Error('数据库中的系统角色不完整，请重新运行迁移')
  }

  await tx.delete(userRoles).where(eq(userRoles.userId, userId))
  await tx.insert(userRoles).values(roleRows.map(role => ({
    userId,
    roleId: role.id
  })))
}

const linkMatchingMember = async (
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  userId: string,
  account: string
) => {
  const [matchingMember] = await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.memberKey, normalizeAccount(account)))
    .limit(1)
  if (matchingMember) {
    await tx.insert(userMembers).values({
      userId,
      memberId: matchingMember.id
    }).onConflictDoNothing()
  }
}

export const listCmsUsers = async () => rowsToManagedUsers(await loadUserRows())

export const getCmsUser = async (userId: string) =>
  rowsToManagedUsers(await loadUserRows(userId))[0] ?? null

export const countAdmins = async () => {
  const db = getDatabase()
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.code, 'admin')))
    .innerJoin(users, and(eq(userRoles.userId, users.id), eq(users.status, 'active')))

  return new Set(rows.map(row => row.userId)).size
}

export const createCmsUser = async (
  input: CreateCmsUserInput,
  actorUserId: string | null,
  auditAction = 'user.create'
) => {
  const db = getDatabase()
  const passwordHash = await hashCmsPassword(input.password)

  const userId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        account: normalizeAccount(input.account),
        passwordHash
      })
      .returning({ id: users.id })

    if (!created) {
      throw new Error('创建用户失败')
    }

    await replaceRoles(tx, created.id, input.roles)
    await linkMatchingMember(tx, created.id, input.account)
    await tx.insert(auditLogs).values({
      actorUserId,
      action: auditAction,
      targetType: 'user',
      targetId: created.id,
      metadata: {
        account: normalizeAccount(input.account),
        roles: uniqueRoleCodes(input.roles)
      }
    })

    return created.id
  })

  return getCmsUser(userId)
}

export const bootstrapCmsAdmin = async (input: Omit<CreateCmsUserInput, 'roles'>) => {
  const db = getDatabase()
  const passwordHash = await hashCmsPassword(input.password)

  const userId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(884021501)`)
    const existingAdmins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.code, 'admin')))
      .limit(1)

    if (existingAdmins.length > 0) {
      throw new Error('CMS_ADMIN_ALREADY_EXISTS')
    }

    const [created] = await tx
      .insert(users)
      .values({
        account: normalizeAccount(input.account),
        passwordHash
      })
      .returning({ id: users.id })

    if (!created) {
      throw new Error('创建管理员失败')
    }

    await replaceRoles(tx, created.id, ['admin'])
    await linkMatchingMember(tx, created.id, input.account)
    await tx.insert(auditLogs).values({
      actorUserId: created.id,
      action: 'admin.bootstrap',
      targetType: 'user',
      targetId: created.id,
      metadata: {
        account: normalizeAccount(input.account),
        roles: ['admin']
      }
    })

    return created.id
  })

  return getCmsUser(userId)
}

export const updateCmsUser = async (
  userId: string,
  input: UpdateCmsUserInput,
  actorUserId: string
) => {
  const db = getDatabase()
  const passwordHash = input.password
    ? await hashCmsPassword(input.password)
    : undefined

  await db.transaction(async (tx) => {
    const mayRemoveAdmin = input.status === 'disabled'
      || (input.roles !== undefined && !input.roles.includes('admin'))
    if (mayRemoveAdmin) {
      await tx.execute(sql`select pg_advisory_xact_lock(884021502)`)
      const [activeAdmin] = await tx
        .select({ userId: users.id })
        .from(users)
        .innerJoin(userRoles, eq(users.id, userRoles.userId))
        .innerJoin(roles, and(
          eq(userRoles.roleId, roles.id),
          eq(roles.code, 'admin')
        ))
        .where(and(
          eq(users.id, userId),
          eq(users.status, 'active')
        ))
        .limit(1)

      if (activeAdmin) {
        const adminRows = await tx
          .select({ userId: users.id })
          .from(users)
          .innerJoin(userRoles, eq(users.id, userRoles.userId))
          .innerJoin(roles, and(
            eq(userRoles.roleId, roles.id),
            eq(roles.code, 'admin')
          ))
          .where(eq(users.status, 'active'))

        if (new Set(adminRows.map(row => row.userId)).size <= 1) {
          throw new CmsLastAdminError()
        }
      }
    }

    await tx
      .update(users)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))

    if (input.roles !== undefined) {
      await replaceRoles(tx, userId, input.roles)
    }

    if (input.status === 'disabled' || passwordHash) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      metadata: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.roles !== undefined ? { roles: uniqueRoleCodes(input.roles) } : {}),
        ...(passwordHash ? { passwordChanged: true } : {})
      }
    })
  })

  return getCmsUser(userId)
}

export const changeCmsOwnPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionToken: string
) => {
  const db = getDatabase()
  const [current] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!current || !await verifyCmsPassword(current.passwordHash, currentPassword)) {
    return false
  }

  const passwordHash = await hashCmsPassword(newPassword)
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date()
      })
      .where(and(
        eq(users.id, userId),
        eq(users.passwordHash, current.passwordHash)
      ))
      .returning({ id: users.id })

    if (!updated) {
      return false
    }

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ne(sessions.tokenHash, hashSessionToken(currentSessionToken))
      ))
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: 'user.password.change',
      targetType: 'user',
      targetId: userId,
      metadata: {
        otherSessionsRevoked: true
      }
    })

    return true
  })
}

export const authenticateCmsUser = async (account: string, password: string) => {
  const db = getDatabase()
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.account, normalizeAccount(account)))
    .limit(1)

  const passwordHash = user?.passwordHash || dummyPasswordHash
  const valid = await verifyCmsPassword(passwordHash, password)
  return user && user.status === 'active' && valid
    ? getCmsUser(user.id)
    : null
}

export const createCmsSession = async (
  user: CmsUser,
  ttlHours: number,
  ipHash: string | null,
  userAgent: string | undefined
) => {
  const db = getDatabase()
  const token = createSessionToken()
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)

  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ipHash,
      userAgent: userAgent?.slice(0, 512)
    })
    await tx.insert(auditLogs).values({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'session',
      metadata: { roles: user.roles },
      ipHash
    })
  })

  return { token, expiresAt }
}

export const getCmsSessionUser = async (token: string) => {
  const db = getDatabase()
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.tokenHash, hashSessionToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      eq(users.status, 'active')
    ))
    .limit(1)

  if (!row) {
    return null
  }

  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.tokenHash, hashSessionToken(token)))

  return getCmsUser(row.userId)
}

export const revokeCmsSession = async (
  token: string,
  actorUserId: string,
  ipHash: string | null
) => {
  const db = getDatabase()
  const tokenHash = hashSessionToken(token)

  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'auth.logout',
      targetType: 'session',
      metadata: {},
      ipHash
    })
  })
}
