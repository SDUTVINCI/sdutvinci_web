export type CmsEditLockTargetType = 'article' | 'draft'

export interface CmsEditLockHolder {
  userId: string
  account: string
  memberName: string | null
}

export interface CmsEditLock {
  targetType: CmsEditLockTargetType
  targetId: string
  holder: CmsEditLockHolder
  heldByCurrentUser: boolean
  leaseId: string | null
  acquiredAt: string
  heartbeatAt: string
  expiresAt: string
}

export interface CmsEditLockResponse {
  acquired: boolean
  lock: CmsEditLock
  heartbeatIntervalMs: number
}
