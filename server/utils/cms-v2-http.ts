import { createError } from 'h3'
import { assertCmsRevisionShadowEnabled } from './cms-v2-flags'

export const requireCmsRevisionShadowApi = () => {
  try {
    assertCmsRevisionShadowEnabled()
  } catch {
    throw createError({ statusCode: 404, message: '数据库历史功能未启用' })
  }
}
