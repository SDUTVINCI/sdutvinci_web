import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { publishOrganization } from '../../../services/organization'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  expectedVersion: z.number().int().min(1),
  confirmation: z.literal('PUBLISH_ORGANIZATION')
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const body = await readValidatedBody(event, schema.parse)
  try {
    return await publishOrganization(body.expectedVersion, auth.user.id)
  } catch (error) {
    if ((error as Error).message === 'ORGANIZATION_VERSION_CONFLICT') {
      throw createError({ statusCode: 409, message: '架构已被其他管理员修改，请刷新后重试' })
    }
    throw createError({ statusCode: 400, message: '组织架构数据不合法', cause: error })
  }
})
