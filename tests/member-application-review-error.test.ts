import { describe, expect, it } from 'vitest'
import { memberApplicationReviewError } from '../server/utils/member-application-review-error'
import { CmsMemberKeyConflictError } from '../server/services/cms-members'

describe('成员申请审核错误提示', () => {
  it('识别 Drizzle 包装的数据库冲突，且不泄露 SQL 参数', () => {
    const failure = memberApplicationReviewError(new Error('SQL with private parameters', {
      cause: { code: '23505', constraint: 'members_source_path_unique' }
    }))
    expect(failure).toEqual({ statusCode: 409, message: '该申请已有成员档案，请核对后重试' })
    expect(memberApplicationReviewError({ cause: { cause: { code: '23505', constraint: 'member_applications_avatar_object_key_unique' } } }))
      .toMatchObject({ statusCode: 409, message: expect.stringContaining('头像') })
    expect(memberApplicationReviewError(new CmsMemberKeyConflictError('已有档案'))).toMatchObject({ message: '已有档案' })
  })

  it('区分状态冲突、无效头像和未知故障，容忍循环 cause', () => {
    expect(memberApplicationReviewError(new Error('MEMBER_APPLICATION_MEMBER_DELETED'))?.statusCode).toBe(409)
    expect(memberApplicationReviewError(new Error('MEMBER_APPLICATION_AVATAR_KEY_INVALID'))?.statusCode).toBe(400)
    expect(memberApplicationReviewError(new Error('database disconnected'))).toBeNull()
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    expect(memberApplicationReviewError(cycle)).toBeNull()
  })
})
