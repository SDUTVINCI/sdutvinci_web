import { createError, getRouterParam, readBody } from 'h3'
import { submitMemberApplication } from '../../../services/member-applications'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  try { return await submitMemberApplication(String(getRouterParam(event, 'id')), String(body.token || ''), body.profile as Record<string, unknown>) }
  catch { throw createError({ statusCode: 400, message: '成员信息不完整、选项无效或申请已过期' }) }
})
