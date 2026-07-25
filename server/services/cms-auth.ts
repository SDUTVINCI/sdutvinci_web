import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { CmsManagedUser, CmsRoleCode, CmsUser } from '../../shared/types/cms-auth'
import { cmsRoleCodes } from '../../shared/types/cms-auth'
import { getDatabase } from '../db/client'
import {
  auditLogs,
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
  email: string
  displayName: string
  password: string
  roles: CmsRoleCode[]
}

export interface UpdateCmsUserInput {
  displayName?: string
  status?: 'active' | 'disabled'
  roles?: CmsRoleCode[]
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const normalizeAccount = (account: string) => account.trim().toLowerCase()

const uniqueRoleCodes = (values: CmsRoleCode[]) =>
  [...new Set(values)].filter(value => cmsRoleCodes.includes(value))

const loadUserRows = async (userId?: string) => {
  const db = getDatabase()
  const query = db
    .select({
      id: users.id,
      account: users.account,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      role: roles.code,
      memberId: userMembers.memberId
    })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .orderBy(asc(users.createdAt), asc(users.id))

  return userId ? query.where(eq(users.id, userId)) : query
}

const rowsToManagedUsers = (rows: Awaited<ReturnType<typeof loadUserRows>>): CmsManagedUser[] => {
  const result = new Map<string, CmsManagedUser>()

  for (const row of rows) {
    const current = result.get(row.id) ?? {
      id: row.id,
      account: row.account,
      email: row.email,
      displayName: row.displayName,
      status: row.status,
      roles: [],
      memberId: row.memberId,
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
        email: normalizeEmail(input.email),
        displayName: input.displayName.trim(),
        passwordHash
      })
      .returning({ id: users.id })

    if (!created) {
      throw new Error('创建用户失败')
    }

    await replaceRoles(tx, created.id, input.roles)
    await tx.insert(auditLogs).values({
      actorUserId,
      action: auditAction,
      targetType: 'user',
      targetId: created.id,
      metadata: {
        account: normalizeAccount(input.account),
        email: normalizeEmail(input.email),
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
        email: normalizeEmail(input.email),
        displayName: input.displayName.trim(),
        passwordHash
      })
      .returning({ id: users.id })

    if (!created) {
      throw new Error('创建管理员失败')
    }

    await replaceRoles(tx, created.id, ['admin'])
    await tx.insert(auditLogs).values({
      actorUserId: created.id,
      action: 'admin.bootstrap',
      targetType: 'user',
      targetId: created.id,
      metadata: {
        account: normalizeAccount(input.account),
        email: normalizeEmail(input.email),
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

  await db.transaction(async (tx) => {
    if (input.displayName !== undefined || input.status !== undefined) {
      await tx
        .update(users)
        .set({
          ...(input.displayName !== undefined
            ? { displayName: input.displayName.trim() }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
    }

    if (input.roles !== undefined) {
      await replaceRoles(tx, userId, input.roles)
    }

    if (input.status === 'disabled') {
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
      metadata: { ...input }
    })
  })

  return getCmsUser(userId)
}

export const authenticateCmsUser = async (account: string, password: string) => {
  const db = getDatabase()
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.account, normalizeAccount(account)))
    .limit(1)

  if (!user || user.status !== 'active') {
    return null
  }

  const valid = await verifyCmsPassword(user.passwordHash, password)
  return valid ? getCmsUser(user.id) : null
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
