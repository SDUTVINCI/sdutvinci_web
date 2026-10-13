import { and, eq, isNull } from 'drizzle-orm'
import { roles, userRoles, users, userMembers } from '../db/schema'
import { getDatabase } from '../db/client'

type Transaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0]

export const assertNotOwnMemberWrite = async (tx: Transaction, memberId: string, actorUserId: string) => {
  const [own] = await tx.select({ id: userMembers.memberId }).from(userMembers)
    .where(and(eq(userMembers.memberId, memberId), eq(userMembers.userId, actorUserId))).limit(1)
  if (own) throw new Error('MEMBER_SELF_REVIEW_REQUIRED')
}

export const synchronizeMemberAccountRole = async (tx: Transaction, memberId: string, isLearner: boolean) => {
  const [binding] = await tx.select({ userId: users.id }).from(userMembers)
    .innerJoin(users, eq(users.id, userMembers.userId))
    .where(and(eq(userMembers.memberId, memberId), isNull(users.deletedAt))).limit(1)
  if (!binding) return
  await tx.select({ id: users.id }).from(users).where(eq(users.id, binding.userId)).for('update')
  const existing = await tx.select({ code: roles.code }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, binding.userId))
  // Member classification must never implicitly grant or remove administrator privileges.
  if (existing.some(role => role.code === 'admin')) return
  const [role] = await tx.select({ id: roles.id }).from(roles)
    .where(eq(roles.code, isLearner ? 'reader' : 'member')).limit(1)
  if (!role) throw new Error('MEMBER_ACCOUNT_ROLE_MISSING')
  await tx.delete(userRoles).where(eq(userRoles.userId, binding.userId))
  await tx.insert(userRoles).values({ userId: binding.userId, roleId: role.id })
  await tx.update(users).set({ updatedAt: new Date() }).where(eq(users.id, binding.userId))
}
