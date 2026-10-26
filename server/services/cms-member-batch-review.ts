import type { CmsMemberReviewAction, CmsMemberReviewItem, CmsMemberReviewKind, CmsMemberReviewResult } from '../../shared/types/cms-member-review'
import { CMS_MEMBER_REVIEW_MAX_ITEMS } from '../../shared/types/cms-member-review'
import { applyMemberProposal, getMemberProposal, rejectMemberProposal, CmsMemberVersionConflictError, CmsMemberKeyConflictError } from './cms-members'
import { reviewMemberApplication } from './member-applications'
import { memberApplicationReviewError } from '../utils/member-application-review-error'
import { reviewAccountRegistration, AccountRegistrationStateError, AccountRegistrationAlreadyRegisteredError, AccountRegistrationAccountUnavailableError } from './account-registrations'

const failureMessage = (error: unknown) => {
  if (error instanceof CmsMemberVersionConflictError || error instanceof CmsMemberKeyConflictError) return error.message
  if (error instanceof AccountRegistrationAlreadyRegisteredError) return '该成员已有账号，请刷新申请列表'
  if (error instanceof AccountRegistrationAccountUnavailableError) return '账号 ID 已被占用或与成员档案不一致'
  if (error instanceof AccountRegistrationStateError) return '注册申请已处理，请刷新后重试'
  const messages: Record<string, string> = {
    MEMBER_PROPOSAL_NOT_FOUND: '资料修改申请不存在', MEMBER_PROPOSAL_NOT_PENDING: '申请已被处理，请刷新列表',
    MEMBER_APPLICATION_STATE_INVALID: '成员申请已被处理或状态无效', MEMBER_NOT_FOUND: '成员档案已删除或不存在',
    MEMBER_GRADE_INVALID: '年级已停用，请重新提交', MEMBER_GROUP_INVALID: '组别已变化，请重新提交',
    MEMBER_SEASON_INVALID: '参加赛季中包含不可选的新届次', MEMBER_ADVISOR_SEASON_INVALID: '顾问届次中包含不可选的新届次',
    MEMBER_KEY_IMMUTABLE: 'PR 提案不能修改成员稳定 ID', MEMBER_BATCH_DELETE_EXCLUDED: '删除档案需单独确认',
    MEMBER_VERSION_REQUIRED: '缺少审核版本，请刷新列表', MEMBER_TEACHER_DETAILS_INVALID: '老师补充信息无效'
  }
  return error instanceof Error ? messages[error.message] || '审核失败，申请已保留，请查看单条详情后重试' : '审核失败，请重试'
}

export const batchReviewMemberRequests = async (
  kind: CmsMemberReviewKind, action: CmsMemberReviewAction, items: CmsMemberReviewItem[], note: string, actorUserId: string
): Promise<CmsMemberReviewResult[]> => {
  if (!items.length || items.length > CMS_MEMBER_REVIEW_MAX_ITEMS || new Set(items.map(item => item.id)).size !== items.length) throw new Error('MEMBER_BATCH_ITEMS_INVALID')
  const results: CmsMemberReviewResult[] = []
  for (const item of items) {
    try {
      if (kind === 'application') await reviewMemberApplication(item.id, action, note, actorUserId)
      else if (kind === 'registration') await reviewAccountRegistration(item.id, action, note, actorUserId)
      else {
        const proposal = await getMemberProposal(item.id)
        if (!proposal) throw new Error('MEMBER_PROPOSAL_NOT_FOUND')
        if (proposal.action === 'delete') throw new Error('MEMBER_BATCH_DELETE_EXCLUDED')
        if (action === 'reject') await rejectMemberProposal(item.id, note, actorUserId)
        else {
          if (!item.version) throw new Error('MEMBER_VERSION_REQUIRED')
          await applyMemberProposal(item.id, item.version, 'APPLY_MEMBER_PROPOSAL', actorUserId, note)
        }
      }
      results.push({ id: item.id, ok: true, message: action === 'approve' ? '已通过并生效' : '已拒绝' })
    } catch (error) { results.push({ id: item.id, ok: false, message: (kind === 'application' ? memberApplicationReviewError(error)?.message : null) || failureMessage(error) }) }
  }
  return results
}
