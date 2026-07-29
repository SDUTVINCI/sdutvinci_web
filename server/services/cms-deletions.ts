import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getContentPublishMode } from '../utils/cms-v2-flags'
import {
  deleteCmsArticleDatabase,
  restoreCmsDeletedArticleDatabase
} from './cms-deletions-database'
import {
  deleteCmsArticleGitFirst,
  restoreCmsArticleGitFirst
} from './cms-deletions-legacy'

export {
  CmsArticleDeletionGitError,
  CmsArticleDeletionNotFoundError,
  CmsArticleDeletionStateError
} from './cms-deletions-legacy'

export const deleteCmsArticle = async (
  articleId: string,
  operatorUserId: string
): Promise<CmsPublishResult> => getContentPublishMode() === 'database'
  ? deleteCmsArticleDatabase(articleId, operatorUserId)
  : deleteCmsArticleGitFirst(articleId, operatorUserId)

export const restoreCmsArticle = async (
  articleId: string,
  operatorUserId: string
): Promise<CmsPublishResult> => getContentPublishMode() === 'database'
  ? restoreCmsDeletedArticleDatabase(articleId, operatorUserId)
  : restoreCmsArticleGitFirst(articleId, operatorUserId)
