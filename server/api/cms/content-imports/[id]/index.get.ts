import { createError, getRouterParam } from 'h3'
import { getContentPrImportRun } from '../../../../services/content-pr-import'
import { requireContentImportAuth } from '../../../../utils/content-import-http'

export default defineEventHandler(async (event) => {
  await requireContentImportAuth(event)
  const run = await getContentPrImportRun(getRouterParam(event, 'id') || '')
  if (!run) throw createError({ statusCode: 404, message: '导入运行不存在' })
  return { run }
})
