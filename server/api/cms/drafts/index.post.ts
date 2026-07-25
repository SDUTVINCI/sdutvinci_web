import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  createCmsDraftForArticle,
  createCmsNewArticleDraft
} from '../../../services/cms-drafts'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    articleId: z.string().uuid()
  }).strict(),
  z.object({
    kind: z.literal('new'),
    collection: z.enum(['news', 'wiki']),
    title: z.string().trim().min(1).max(200)
  }).strict()
])

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)

  try {
    const draft = input.kind === 'existing'
      ? await createCmsDraftForArticle(input.articleId, auth.user.id)
      : await createCmsNewArticleDraft(input.collection, input.title, auth.user.id)
    return { draft }
  } catch (error) {
    if (error instanceof Error && error.message === 'ARTICLE_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '文章不存在' })
    }
    throw error
  }
})
