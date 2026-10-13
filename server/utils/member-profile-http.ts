import { createError } from 'h3'
import { CmsMemberVersionConflictError } from '../services/cms-members'

export const throwMemberProfileError = (error: unknown): never => {
  if (error instanceof CmsMemberVersionConflictError) throw createError({ statusCode: 409, message: error.message })
  const messages: Record<string, string> = {
    MEMBER_NOT_FOUND: '账号尚未关联有效成员档案',
    MEMBER_PROFILE_PENDING: '已有待审核的资料修改，请等待处理或撤回后重新提交',
    MEMBER_PROFILE_UNCHANGED: '没有需要提交的修改',
    MEMBER_PROFILE_INCOMPLETE: '请填写头像、年级和正式成员所需的职务、赛季',
    MEMBER_LEARNER_FIELDS_INVALID: '学员不能填写职务、参加过的赛季或顾问届次',
    MEMBER_AVATAR_UPLOAD_INVALID: '请重新上传本人头像后提交',
    MEMBER_GRADE_INVALID: '该年级未开放申请，请刷新选项或联系管理员',
    MEMBER_GROUP_INVALID: '组别不属于所选年级的可选范围',
    MEMBER_SEASON_INVALID: '参加过的赛季选项已停用，请刷新后重试',
    MEMBER_ADVISOR_SEASON_INVALID: '顾问届次选项已停用，请刷新后重试',
    MEMBER_COLLEGE_INVALID: '请选择有效学院或单位',
    MEMBER_PROPOSAL_NOT_PENDING: '申请已处理或不存在，请刷新后重试'
  }
  if (error instanceof Error && messages[error.message]) {
    throw createError({ statusCode: error.message === 'MEMBER_NOT_FOUND' ? 404 : 400, message: messages[error.message] })
  }
  throw createError({ statusCode: 400, message: '资料无效或暂时无法保存，请检查后重试' })
}
