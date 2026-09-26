import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { userMembers, users } from '../db/schema'

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

// Older account deletions can leave a user_members row behind. A deleted account
// cannot own a member profile, and its row also blocks the unique member link.
export const getActiveMemberAccountLink = async (tx: CmsTransaction, memberId: string) => {
  await tx.execute(sql`
    delete from user_members as link using users as account
    where link.user_id = account.id
      and link.member_id = ${memberId}
      and account.deleted_at is not null
  `)
  const [link] = await tx.select({
    userId: userMembers.userId,
    account: users.account
  }).from(userMembers)
    .innerJoin(users, eq(userMembers.userId, users.id))
    .where(and(eq(userMembers.memberId, memberId), isNull(users.deletedAt)))
    .limit(1)
  return link ?? null
}
