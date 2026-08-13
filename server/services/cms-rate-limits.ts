import { and, eq, lt, sql } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { rateLimitBuckets } from '../db/schema'
import { getCmsServerConfig } from '../utils/cms-config'
import { hashCmsSecurityKey } from '../utils/cms-security'

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

interface ConsumeRateLimitInput {
  scope: string
  key: string
  limit: number
  windowMinutes: number
  blockMinutes?: number
  blockWhenCountReaches?: boolean
  now?: Date
}

export class CmsRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('CMS_RATE_LIMITED')
  }
}

const secondsUntil = (future: Date, now: Date) =>
  Math.max(1, Math.ceil((future.getTime() - now.getTime()) / 1000))

const lockBucket = async (
  tx: CmsTransaction,
  scope: string,
  keyHash: string
) => {
  const lockKey = `${scope}:${keyHash}`
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  )
}

const consumeRateLimit = async (input: ConsumeRateLimitInput) => {
  const now = input.now || new Date()
  const keyHash = hashCmsSecurityKey(input.scope, input.key)
  const windowMilliseconds = input.windowMinutes * 60_000
  const blockMilliseconds = (input.blockMinutes || input.windowMinutes) * 60_000

  const result = await getDatabase().transaction(async (tx) => {
    await lockBucket(tx, input.scope, keyHash)
    const [current] = await tx
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.scope, input.scope),
        eq(rateLimitBuckets.keyHash, keyHash)
      ))
      .limit(1)

    if (current?.blockedUntil && current.blockedUntil > now) {
      return { retryAfterSeconds: secondsUntil(current.blockedUntil, now) }
    }

    const windowExpired = !current
      || now.getTime() - current.windowStartedAt.getTime() >= windowMilliseconds
    const windowStartedAt = windowExpired ? now : current.windowStartedAt
    const attemptCount = windowExpired ? 1 : current.attemptCount + 1
    const limitReached = input.blockWhenCountReaches
      ? attemptCount >= input.limit
      : attemptCount > input.limit
    const blockedUntil = limitReached
      ? new Date(now.getTime() + blockMilliseconds)
      : null

    await tx
      .insert(rateLimitBuckets)
      .values({
        scope: input.scope,
        keyHash,
        windowStartedAt,
        attemptCount,
        blockedUntil,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.scope, rateLimitBuckets.keyHash],
        set: {
          windowStartedAt,
          attemptCount,
          blockedUntil,
          updatedAt: now
        }
      })

    return {
      retryAfterSeconds: blockedUntil
        ? secondsUntil(blockedUntil, now)
        : 0
    }
  })

  if (result.retryAfterSeconds) {
    throw new CmsRateLimitError(result.retryAfterSeconds)
  }
}

const checkBlockedBucket = async (
  scope: string,
  key: string,
  now = new Date()
) => {
  const keyHash = hashCmsSecurityKey(scope, key)
  const [current] = await getDatabase()
    .select({ blockedUntil: rateLimitBuckets.blockedUntil })
    .from(rateLimitBuckets)
    .where(and(
      eq(rateLimitBuckets.scope, scope),
      eq(rateLimitBuckets.keyHash, keyHash)
    ))
    .limit(1)

  if (current?.blockedUntil && current.blockedUntil > now) {
    throw new CmsRateLimitError(secondsUntil(current.blockedUntil, now))
  }
}

export const assertCmsLoginAllowed = async (
  account: string,
  ipKey: string,
  now = new Date()
) => {
  const config = getCmsServerConfig()
  const normalizedAccount = account.trim().toLowerCase()
  await checkBlockedBucket('login-account-failure', normalizedAccount, now)
  await consumeRateLimit({
    scope: 'login-ip-attempt',
    key: ipKey,
    limit: config.CMS_LOGIN_IP_ATTEMPT_LIMIT,
    windowMinutes: config.CMS_LOGIN_IP_WINDOW_MINUTES,
    now
  })
}

export const recordCmsLoginFailure = async (
  account: string,
  now = new Date()
) => {
  const config = getCmsServerConfig()
  await consumeRateLimit({
    scope: 'login-account-failure',
    key: account.trim().toLowerCase(),
    limit: config.CMS_LOGIN_FAILURE_LIMIT,
    windowMinutes: config.CMS_LOGIN_FAILURE_WINDOW_MINUTES,
    blockMinutes: config.CMS_LOGIN_LOCKOUT_MINUTES,
    blockWhenCountReaches: true,
    now
  })
}

export const clearCmsLoginFailures = async (account: string) => {
  const keyHash = hashCmsSecurityKey(
    'login-account-failure',
    account.trim().toLowerCase()
  )
  await getDatabase()
    .delete(rateLimitBuckets)
    .where(and(
      eq(rateLimitBuckets.scope, 'login-account-failure'),
      eq(rateLimitBuckets.keyHash, keyHash)
    ))
}

export const consumeCmsMediaUploadLimit = async (
  userId: string,
  now = new Date()
) => {
  const config = getCmsServerConfig()
  await consumeRateLimit({
    scope: 'media-upload-user',
    key: userId,
    limit: config.CMS_MEDIA_UPLOAD_LIMIT,
    windowMinutes: config.CMS_MEDIA_UPLOAD_WINDOW_MINUTES,
    now
  })
}

export const consumePublicMemberApplicationLimit = async (ipKey: string, now = new Date()) =>
  consumeRateLimit({
    scope: 'public-member-application-ip',
    key: ipKey,
    limit: 10,
    windowMinutes: 60,
    now
  })

export const consumePublicAccountRegistrationLimit = async (ipKey: string, now = new Date()) =>
  consumeRateLimit({
    scope: 'public-account-registration-ip',
    key: ipKey,
    limit: 10,
    windowMinutes: 60,
    now
  })

export const pruneCmsRateLimitBuckets = async (now = new Date()) => {
  const retentionCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000)
  await getDatabase()
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.updatedAt, retentionCutoff))
}

let nextPruneAt = 0
let prunePromise: Promise<void> | undefined

export const maybePruneCmsRateLimitBuckets = async (now = new Date()) => {
  if (now.getTime() < nextPruneAt) return

  prunePromise ||= pruneCmsRateLimitBuckets(now)
  try {
    await prunePromise
    nextPruneAt = now.getTime() + 60 * 60_000
  } finally {
    prunePromise = undefined
  }
}
