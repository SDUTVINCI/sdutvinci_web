import type { CmsPublishResult } from '../../shared/types/cms-publishing'
import { getContentPublishMode } from '../utils/cms-v2-flags'
import { publishCmsDraftDatabase } from './cms-publishing-database'
import { publishCmsDraftGitFirst } from './cms-publishing-legacy'

export {
  CmsPublishConflictError,
  CmsPublishGitError,
  CmsPublishNotFoundError,
  CmsPublishPathError,
  CmsPublishStateError,
  suggestCmsArticlePath,
  upsertPublishedArticle
} from './cms-publishing-legacy'

export const publishCmsDraft = async (
  draftId: string,
  operatorUserId: string,
  input: { version: number, relativePath?: string }
): Promise<CmsPublishResult> => {
  if (getContentPublishMode() === 'database') {
    return publishCmsDraftDatabase(draftId, operatorUserId, input)
  }
  return publishCmsDraftGitFirst(draftId, operatorUserId, input)
}
