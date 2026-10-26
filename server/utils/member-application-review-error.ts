import { CmsMemberKeyConflictError } from '../services/cms-members'

export const memberApplicationReviewError = (error: unknown): { statusCode: number, message: string } | null => {
  if (error instanceof CmsMemberKeyConflictError) return { statusCode: 409, message: error.message }
  const messages: Record<string, [number, string]> = {
    MEMBER_APPLICATION_STATE_INVALID: [409, '成员申请已被处理或状态无效，请刷新列表'],
    MEMBER_APPLICATION_MEMBER_DELETED: [409, '该申请已通过，但对应成员档案已删除，请核对档案'],
    MEMBER_APPLICATION_AVATAR_KEY_INVALID: [400, '申请头像信息无效，请重新上传头像后提交'],
    MEMBER_GRADE_INVALID: [400, '年级已停用，请重新提交'],
    MEMBER_GROUP_INVALID: [400, '组别已变化，请重新提交'],
    MEMBER_SEASON_INVALID: [400, '参加赛季中包含不可选的届次，请重新提交'],
    MEMBER_ADVISOR_SEASON_INVALID: [400, '顾问届次中包含不可选的届次，请重新提交']
  }
  if (error instanceof Error && messages[error.message]) {
    const [statusCode, message] = messages[error.message]!
    return { statusCode, message }
  }
  // Drizzle wraps PostgreSQL errors in cause; never expose SQL or parameter values.
  const seen = new Set<object>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && current.code === '23505') {
      const constraint = 'constraint' in current ? current.constraint : undefined
      const message = constraint === 'members_source_path_unique'
        ? '该申请已有成员档案，请核对后重试'
        : constraint === 'member_applications_avatar_object_key_unique'
          ? '申请头像与已有记录冲突，申请已保留，请联系管理员处理'
          : '成员稳定 ID 或关联记录已被使用，请刷新后重试'
      return { statusCode: 409, message }
    }
    current = 'cause' in current ? current.cause : null
  }
  return null
}
