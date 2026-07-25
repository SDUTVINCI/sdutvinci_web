import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import { findCmsDraftForArticle } from '../../../../services/cms-drafts'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  const articleId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const draft = await findCmsDraftForArticle(articleId, auth.user.id)
  if (!draft) {
    throw createError({ statusCode: 404, message: '尚无草稿' })
  }
  return { draft }
})
