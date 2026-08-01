import { createError, getRouterParam } from 'h3'
import { getContentPrImportArtifact } from '../../../../../services/content-pr-import'
import { requireContentImportAuth } from '../../../../../utils/content-import-http'

export default defineEventHandler(async (event) => {
  await requireContentImportAuth(event)
  const artifact = await getContentPrImportArtifact(
    getRouterParam(event, 'id') || '',
    getRouterParam(event, 'itemId') || ''
  )
  if (!artifact) throw createError({ statusCode: 404, message: '导入项目不存在' })
  return { artifact }
})
