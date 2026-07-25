import { createError } from 'h3'
import {
  CmsDraftConflictError,
  CmsDraftNotFoundError,
  CmsDraftStateError
} from '../services/cms-drafts'
import {
  CmsEditLockDraftNotFoundError,
  CmsEditLockLostError
} from '../services/cms-edit-locks'
import {
  CmsPublishedVersionConflictError,
  CmsReviewNotFoundError,
  CmsReviewStateError
} from '../services/cms-reviews'
import {
  CmsPublishConflictError,
  CmsPublishGitError,
  CmsPublishNotFoundError,
  CmsPublishPathError,
  CmsPublishStateError
} from '../services/cms-publishing'

export const throwCmsWorkflowError = (error: unknown): never => {
  if (
    error instanceof CmsDraftNotFoundError
    || error instanceof CmsEditLockDraftNotFoundError
    || error instanceof CmsReviewNotFoundError
    || error instanceof CmsPublishNotFoundError
  ) {
    throw createError({ statusCode: 404, message: '草稿不存在' })
  }
  if (error instanceof CmsEditLockLostError) {
    throw createError({
      statusCode: 409,
      message: '编辑锁已失效，请重新获取后继续'
    })
  }
  if (error instanceof CmsDraftConflictError) {
    throw createError({
      statusCode: 409,
      message: '草稿已在其他页面更新，请刷新后继续'
    })
  }
  if (error instanceof CmsDraftStateError || error instanceof CmsReviewStateError) {
    throw createError({
      statusCode: 409,
      message: '草稿状态或版本已经变化，请刷新后继续'
    })
  }
  if (error instanceof CmsPublishStateError) {
    throw createError({
      statusCode: 409,
      message: '草稿必须处于已审核通过状态，且版本不能发生变化'
    })
  }
  if (error instanceof CmsPublishConflictError) {
    throw createError({
      statusCode: 409,
      message: 'Git 远端正式内容已变化，请重新同步草稿并审核后再发布'
    })
  }
  if (error instanceof CmsPublishPathError) {
    throw createError({ statusCode: 400, message: error.message })
  }
  if (error instanceof CmsPublishGitError) {
    throw createError({
      statusCode: 503,
      message: `Git 发布失败，草稿仍保持已通过，可修复后重试：${error.message}`
    })
  }
  if (error instanceof CmsPublishedVersionConflictError) {
    throw createError({
      statusCode: 409,
      message: '当前文章已有更新，请重新同步后再发布。',
      data: {
        code: 'PUBLISHED_VERSION_CONFLICT',
        currentContentHash: error.currentContentHash
      }
    })
  }
  throw error
}
