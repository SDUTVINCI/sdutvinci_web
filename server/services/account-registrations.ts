import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type {
  AccountRegistrationMemberOption,
  CmsAccountRegistrationApplication
} from '../../shared/types/account-registration'
import { cmsAccountPattern } from '../../shared/types/cms-auth'
import { getDatabase } from '../db/client'
import {
  accountRegistrationApplications,
  auditLogs,
  members,
  roles,
  userMembers,
  userRoles,
  users
} from '../db/schema'
import { hashCmsPassword } from '../utils/cms-security'
import { memberKeyFromName } from '../utils/member-key'

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

const ACCOUNT_REGISTRATION_LOCK = 884021503

export class AccountRegistrationAlreadyRegisteredError extends Error {
  constructor() {
    super('ACCOUNT_REGISTRATION_MEMBER_ALREADY_REGISTERED')
    this.name = 'AccountRegistrationAlreadyRegisteredError'
  }
}

export class AccountRegistrationPendingError extends Error {
  constructor() {
    super('ACCOUNT_REGISTRATION_ALREADY_PENDING')
    this.name = 'AccountRegistrationPendingError'
  }
}

export class AccountRegistrationStateError extends Error {
  constructor() {
    super('ACCOUNT_REGISTRATION_STATE_INVALID')
    this.name = 'AccountRegistrationStateError'
  }
}

const accountBaseForMember = (member: { memberKey: string, name: string }) => {
  const key = member.memberKey.trim().toLowerCase()
  if (cmsAccountPattern.test(key)) return key
  return memberKeyFromName(member.name)
}

const allocateAccount = (base: string, used: Set<string>) => {
  for (let suffix = 0; suffix < 1_000_000; suffix += 1) {
    const suffixText = suffix ? String(suffix) : ''
    const candidate = `${base.slice(0, 32 - suffixText.length)}${suffixText}`
    if (cmsAccountPattern.test(candidate) && !used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new Error('ACCOUNT_REGISTRATION_ID_EXHAUSTED')
}

const loadUsedAccounts = async (tx: CmsTransaction | ReturnType<typeof getDatabase>) => {
  const [userRows, pendingRows] = await Promise.all([
    tx.select({ account: users.account }).from(users),
    tx.select({ account: accountRegistrationApplications.account })
      .from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.status, 'pending'))
  ])
  return new Set([...userRows, ...pendingRows].map(row => row.account))
}

export const listAccountRegistrationMembers = async (): Promise<AccountRegistrationMemberOption[]> => {
  const db = getDatabase()
  const [memberRows, bindingRows, pendingRows, used] = await Promise.all([
    db.select({
      id: members.id,
      memberKey: members.memberKey,
      name: members.name,
      avatarUrl: members.avatarUrl
    }).from(members).where(and(
      isNull(members.deletedAt),
      sql`${members.currentRevisionId} is not null`
    )).orderBy(asc(members.sortOrder), asc(members.memberKey)),
    db.select({ memberId: userMembers.memberId, account: users.account }).from(userMembers)
      .innerJoin(users, eq(userMembers.userId, users.id)),
    db.select({
      memberId: accountRegistrationApplications.memberId,
      account: accountRegistrationApplications.account
    })
      .from(accountRegistrationApplications)
      .where(eq(accountRegistrationApplications.status, 'pending')),
    loadUsedAccounts(db)
  ])
  const registeredAccounts = new Map(bindingRows.map(row => [row.memberId, row.account]))
  const pendingAccounts = new Map(pendingRows.map(row => [row.memberId, row.account]))

  return memberRows.map((member) => {
    const registrationStatus = registeredAccounts.has(member.id)
      ? 'registered'
      : pendingAccounts.has(member.id)
        ? 'pending'
        : 'available'
    const base = accountBaseForMember(member)
    return {
      ...member,
      account: registeredAccounts.get(member.id)
        || pendingAccounts.get(member.id)
        || allocateAccount(base, new Set(used)),
      registrationStatus
    }
  })
}

export const submitAccountRegistration = async (input: {
  memberId: string
  password: string
  ipHash: string | null
}) => {
  const passwordHash = await hashCmsPassword(input.password)
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_REGISTRATION_LOCK})`)
    const [member] = await tx.select({
      id: members.id,
      memberKey: members.memberKey,
      name: members.name,
      deletedAt: members.deletedAt,
      currentRevisionId: members.currentRevisionId
    }).from(members).where(eq(members.id, input.memberId)).limit(1).for('update')
    if (!member || member.deletedAt || !member.currentRevisionId) {
      throw new Error('ACCOUNT_REGISTRATION_MEMBER_NOT_FOUND')
    }
    const [binding] = await tx.select({ userId: userMembers.userId })
      .from(userMembers).where(eq(userMembers.memberId, member.id)).limit(1)
    if (binding) throw new AccountRegistrationAlreadyRegisteredError()
    const [pending] = await tx.select({ id: accountRegistrationApplications.id })
      .from(accountRegistrationApplications).where(and(
        eq(accountRegistrationApplications.memberId, member.id),
        eq(accountRegistrationApplications.status, 'pending')
      )).limit(1)
    if (pending) throw new AccountRegistrationPendingError()

    const account = allocateAccount(accountBaseForMember(member), await loadUsedAccounts(tx))
    const [application] = await tx.insert(accountRegistrationApplications).values({
      memberId: member.id,
      account,
      passwordHash
    }).returning({
      id: accountRegistrationApplications.id,
      account: accountRegistrationApplications.account,
      status: accountRegistrationApplications.status,
      submittedAt: accountRegistrationApplications.submittedAt
    })
    await tx.insert(auditLogs).values({
      actorUserId: null,
      action: 'account_registration.submit',
      targetType: 'account_registration_application',
      targetId: application!.id,
      metadata: { memberId: member.id, account },
      ipHash: input.ipHash
    })
    return {
      ...application!,
      submittedAt: application!.submittedAt.toISOString()
    }
  })
}

export const listPendingAccountRegistrations = async (): Promise<CmsAccountRegistrationApplication[]> => {
  const rows = await getDatabase().select({
    id: accountRegistrationApplications.id,
    account: accountRegistrationApplications.account,
    status: accountRegistrationApplications.status,
    memberId: members.id,
    memberKey: members.memberKey,
    memberName: members.name,
    memberAvatarUrl: members.avatarUrl,
    submittedAt: accountRegistrationApplications.submittedAt,
    createdAt: accountRegistrationApplications.createdAt,
    updatedAt: accountRegistrationApplications.updatedAt
  }).from(accountRegistrationApplications)
    .innerJoin(members, eq(accountRegistrationApplications.memberId, members.id))
    .where(eq(accountRegistrationApplications.status, 'pending'))
    .orderBy(asc(accountRegistrationApplications.submittedAt))

  return rows.map(row => ({
    id: row.id,
    account: row.account,
    status: row.status as 'pending',
    member: {
      id: row.memberId,
      memberKey: row.memberKey,
      name: row.memberName,
      avatarUrl: row.memberAvatarUrl
    },
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export const reviewAccountRegistration = async (
  id: string,
  action: 'approve' | 'reject',
  note: string,
  actorUserId: string
) => getDatabase().transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_REGISTRATION_LOCK})`)
  const [application] = await tx.select().from(accountRegistrationApplications)
    .where(eq(accountRegistrationApplications.id, id)).limit(1).for('update')
  if (!application || application.status !== 'pending' || !application.passwordHash) {
    throw new AccountRegistrationStateError()
  }
  const now = new Date()
  if (action === 'reject') {
    await tx.update(accountRegistrationApplications).set({
      status: 'rejected',
      passwordHash: null,
      reviewedAt: now,
      reviewedByUserId: actorUserId,
      reviewNote: note,
      updatedAt: now
    }).where(eq(accountRegistrationApplications.id, id))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'account_registration.reject',
      targetType: 'account_registration_application',
      targetId: id,
      metadata: { memberId: application.memberId, account: application.account }
    })
    return { id, status: 'rejected' as const }
  }

  const [member] = await tx.select({
    id: members.id,
    memberKey: members.memberKey,
    name: members.name,
    deletedAt: members.deletedAt,
    currentRevisionId: members.currentRevisionId
  }).from(members).where(eq(members.id, application.memberId)).limit(1).for('update')
  if (!member || member.deletedAt || !member.currentRevisionId) {
    throw new Error('ACCOUNT_REGISTRATION_MEMBER_NOT_FOUND')
  }
  const [binding] = await tx.select({ userId: userMembers.userId })
    .from(userMembers).where(eq(userMembers.memberId, member.id)).limit(1)
  if (binding) throw new AccountRegistrationAlreadyRegisteredError()

  const used = await loadUsedAccounts(tx)
  used.delete(application.account)
  const [accountCollision] = await tx.select({ id: users.id }).from(users)
    .where(eq(users.account, application.account)).limit(1)
  const account = accountCollision
    ? allocateAccount(accountBaseForMember(member), used)
    : application.account
  const [memberRole] = await tx.select({ id: roles.id })
    .from(roles).where(eq(roles.code, 'member')).limit(1)
  if (!memberRole) throw new Error('数据库中的普通成员角色缺失，请重新运行迁移')
  const [user] = await tx.insert(users).values({
    account,
    passwordHash: application.passwordHash
  }).returning({ id: users.id })
  if (!user) throw new Error('ACCOUNT_REGISTRATION_USER_CREATE_FAILED')
  await tx.insert(userRoles).values({ userId: user.id, roleId: memberRole.id })
  await tx.insert(userMembers).values({ userId: user.id, memberId: member.id })
  await tx.update(accountRegistrationApplications).set({
    account,
    status: 'approved',
    passwordHash: null,
    reviewedAt: now,
    reviewedByUserId: actorUserId,
    reviewNote: note,
    approvedUserId: user.id,
    updatedAt: now
  }).where(eq(accountRegistrationApplications.id, id))
  await tx.insert(auditLogs).values({
    actorUserId,
    action: 'account_registration.approve',
    targetType: 'user',
    targetId: user.id,
    metadata: {
      applicationId: id,
      memberId: member.id,
      account,
      roles: ['member']
    }
  })
  return { id, status: 'approved' as const, account, userId: user.id }
})

export const assertAccountNotReserved = async (tx: CmsTransaction, account: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_REGISTRATION_LOCK})`)
  const [reserved] = await tx.select({ id: accountRegistrationApplications.id })
    .from(accountRegistrationApplications).where(and(
      eq(accountRegistrationApplications.account, account),
      eq(accountRegistrationApplications.status, 'pending')
    )).limit(1)
  if (reserved) throw new AccountRegistrationPendingError()
}
