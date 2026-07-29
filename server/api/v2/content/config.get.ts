import { createError } from 'h3'
import {
  getPublicContentSourceConfig,
  PublicContentConfigurationError
} from '../../../utils/public-content-flags'

export default defineEventHandler(() => {
  try {
    return getPublicContentSourceConfig()
  } catch (error) {
    throw createError({
      statusCode: 503,
      message: error instanceof PublicContentConfigurationError
        ? error.message
        : '内容来源配置无效'
    })
  }
})
