import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  createCmsDraftForArticle,
  createCmsNewArticleDraft
} from '../../../services/cms-drafts'
import { getCmsArticle } from '../../../services/cms-articles'
import {
  isWikiDocumentIndexPath,
  WIKI_DOCUMENT_TAGS
} from '../../../../shared/utils/wiki-tags'
import { validateWikiDocumentPath } from '../../../../shared/utils/wiki-document-path'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const wikiDocumentPathFields = {
  documentDate: z.string().trim(),
  documentName: z.string().trim()
}
const wikiChapterFilenameSchema = z.string().trim().min(4).max(200).refine(
  value => value.endsWith('.md')
    && !value.includes('/')
    && !value.includes('\\')
    && value.toLowerCase() !== 'index.md',
  'Wiki 章节文件名不合法'
)

const schema = z.union([
  z.object({
    kind: z.literal('existing'),
    articleId: z.string().uuid()
  }).strict(),
  z.object({
    kind: z.literal('new'),
    collection: z.literal('news'),
    title: z.string().trim().min(1).max(200)
  }).strict(),
  z.object({
    ...wikiDocumentPathFields,
    kind: z.literal('new'),
    collection: z.literal('wiki'),
    wikiContentType: z.literal('document'),
    title: z.string().trim().min(1).max(200),
    tags: z.array(z.enum(WIKI_DOCUMENT_TAGS)).max(WIKI_DOCUMENT_TAGS.length)
  }).strict().superRefine((value, context) => {
    const validation = validateWikiDocumentPath(value.documentDate, value.documentName)
    if (!validation.valid) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: validation.message })
    }
  }),
  z.object({
    kind: z.literal('new'),
    collection: z.literal('wiki'),
    wikiContentType: z.literal('chapter'),
    title: z.string().trim().min(1).max(200),
    parentArticleId: z.string().uuid(),
    filename: wikiChapterFilenameSchema
  }).strict()
])

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)

  try {
    let draft
    if (input.kind === 'existing') {
      draft = await createCmsDraftForArticle(input.articleId, auth.user.id)
    } else if (input.collection === 'news') {
      draft = await createCmsNewArticleDraft('news', input.title, auth.user.id)
    } else if (input.wikiContentType === 'document') {
      const path = validateWikiDocumentPath(input.documentDate, input.documentName)
      if (!path.valid) throw createError({ statusCode: 400, message: path.message })
      draft = await createCmsNewArticleDraft('wiki', input.title, auth.user.id, {
        relativePath: path.relativePath,
        wikiTags: input.tags
      })
    } else {
      const parent = await getCmsArticle(input.parentArticleId)
      if (!parent || parent.collection !== 'wiki' || !isWikiDocumentIndexPath(parent.relativePath)) {
        throw createError({ statusCode: 400, message: '请选择有效的 Wiki 主文档' })
      }
      const directory = parent.relativePath.slice(0, -'/index.md'.length)
      draft = await createCmsNewArticleDraft('wiki', input.title, auth.user.id, {
        relativePath: `${directory}/${input.filename}`
      })
    }
    return { draft }
  } catch (error) {
    if (error instanceof Error && error.message === 'ARTICLE_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '文章不存在' })
    }
    if (error instanceof Error && error.message === 'NEW_ARTICLE_PATH_EXISTS') {
      throw createError({ statusCode: 409, message: '该路径已有正式内容或活动草稿' })
    }
    if (error instanceof Error && [
      'NEW_ARTICLE_PATH_INVALID',
      'WIKI_ARTICLE_PATH_INVALID',
      'WIKI_TAGS_INVALID',
      'WIKI_TAGS_ONLY_DOCUMENT_INDEX'
    ].includes(error.message)) {
      throw createError({ statusCode: 400, message: 'Wiki 内容类型、路径或标签不合法' })
    }
    throw error
  }
})
