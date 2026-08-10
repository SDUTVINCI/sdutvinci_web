import { createError, getRouterParam, readBody } from 'h3'
import { abandonMemberApplication } from '../../services/member-applications'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  try { await abandonMemberApplication(String(getRouterParam(event, 'id')), String(body.token || '')); return { ok: true } }
  catch { throw createError({ statusCode: 404, message: '申请不存在' }) }
})
