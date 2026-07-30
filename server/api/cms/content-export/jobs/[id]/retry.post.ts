import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import { retryContentExportJob } from '../../../../../services/content-export-worker'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return {
      job: await retryContentExportJob(id, auth.user.id)
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTENT_EXPORT_JOB_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '导出任务不存在' })
    }
    if (error instanceof Error && error.message === 'CONTENT_EXPORT_JOB_NOT_FAILED') {
      throw createError({ statusCode: 409, message: '只有已达到重试上限的失败任务可以手动重试' })
    }
    throw error
  }
})
