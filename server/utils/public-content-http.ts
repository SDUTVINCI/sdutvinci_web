import { createError } from 'h3'
import type { PublicContentCollection } from '../../shared/types/public-content'
import {
  assertPublicDatabaseCandidateEnabled,
  PublicContentConfigurationError
} from './public-content-flags'

export const requirePublicDatabaseCandidate = (
  collection: PublicContentCollection
) => {
  try {
    return assertPublicDatabaseCandidateEnabled(collection)
  } catch (error) {
    if (
      error instanceof PublicContentConfigurationError
      && error.message.endsWith('未启用数据库候选')
    ) {
      throw createError({
        statusCode: 404,
        message: '数据库内容候选未启用'
      })
    }
    throw createError({
      statusCode: 503,
      message: error instanceof Error ? error.message : '数据库候选配置无效'
    })
  }
}
