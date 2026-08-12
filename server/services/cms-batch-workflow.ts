import type {
  CmsBatchActionResult,
  CmsBatchDraftItem
} from '../../shared/types/cms-drafts'
import {
  acquireCmsDraftEditLock,
  CmsEditLockDraftNotFoundError,
  CmsEditLockLostError,
  releaseCmsDraftEditLock
} from './cms-edit-locks'
import {
  CmsPublishConflictError,
  CmsPublishGitError,
  CmsPublishNotFoundError,
  CmsPublishPathError,
  CmsPublishStateError,
  publishCmsDraft
} from './cms-publishing'
import {
  approveCmsDraftReview,
  CmsPublishedVersionConflictError,
  CmsReviewNotFoundError,
  CmsReviewStateError,
  submitCmsDraftForReview
} from './cms-reviews'
import {
  CmsDraftConflictError,
  CmsDraftNotFoundError,
  CmsDraftStateError
} from './cms-drafts'
import { CmsV2ConfigurationError } from '../utils/cms-v2-flags'

export const CMS_BATCH_WORKFLOW_CONCURRENCY = 10

const getCmsBatchWorkflowErrorMessage = (error: unknown) => {
  if (error instanceof CmsEditLockLostError
    || (error instanceof Error && error.message === 'EDIT_LOCK_LOST')) {
    return '编辑锁不可用，请关闭正在编辑的页面后重试'
  }
  if (error instanceof CmsPublishedVersionConflictError || error instanceof CmsPublishConflictError) {
    return '正式内容已变化，需要重新同步后再操作'
  }
  if (error instanceof CmsDraftConflictError || error instanceof CmsDraftStateError
    || error instanceof CmsReviewStateError || error instanceof CmsPublishStateError) {
    return '草稿状态或版本已经变化，请刷新后重试'
  }
  if (error instanceof CmsPublishPathError) return error.message
  if (error instanceof CmsPublishGitError || error instanceof CmsV2ConfigurationError) {
    return '发布服务当前不可用；草稿状态已保留'
  }
  if (error instanceof CmsDraftNotFoundError || error instanceof CmsEditLockDraftNotFoundError
    || error instanceof CmsReviewNotFoundError || error instanceof CmsPublishNotFoundError) {
    return '草稿不存在或无权操作'
  }
  return '操作失败，请打开单篇内容查看详情'
}

export const runCmsBatchAction = async (
  items: CmsBatchDraftItem[],
  operation: (item: CmsBatchDraftItem) => Promise<string>
): Promise<CmsBatchActionResult[]> => {
  const results = new Array<CmsBatchActionResult>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(CMS_BATCH_WORKFLOW_CONCURRENCY, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      const item = items[index]!
      try {
        results[index] = { id: item.id, ok: true, message: await operation(item) }
      } catch (error) {
        results[index] = { id: item.id, ok: false, message: getCmsBatchWorkflowErrorMessage(error) }
      }
    }
  })
  await Promise.all(workers)
  return results
}

export const batchSubmitCmsDraftsForReview = async (
  items: CmsBatchDraftItem[],
  userId: string
) => runCmsBatchAction(items, async (item) => {
  const lock = await acquireCmsDraftEditLock(item.id, userId, false)
  if (!lock.acquired || !lock.lock.leaseId) {
    throw new Error('EDIT_LOCK_LOST')
  }
  const leaseId = lock.lock.leaseId
  try {
    await submitCmsDraftForReview(item.id, userId, {
      version: item.version,
      lockLeaseId: leaseId
    })
  } finally {
    await releaseCmsDraftEditLock(item.id, userId, leaseId)
  }
  return '已提交审核'
})

export const batchApproveCmsDrafts = async (
  items: CmsBatchDraftItem[],
  adminUserId: string
) => runCmsBatchAction(items, async (item) => {
  await approveCmsDraftReview(item.id, adminUserId, item.version)
  return '已审核通过'
})

export const batchPublishCmsDrafts = async (
  items: CmsBatchDraftItem[],
  adminUserId: string
) => runCmsBatchAction(items, async (item) => {
  await publishCmsDraft(item.id, adminUserId, { version: item.version })
  return '已正式发布'
})
