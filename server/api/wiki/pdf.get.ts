import { createError, getQuery, setResponseHeader } from 'h3'
import { getPublicArticleFromDatabase } from '../../services/public-content'
import { createWikiPdf } from '../../services/wiki-pdf'
import { requireCmsRequestAuth } from '../../utils/cms-http'

const safeFilename = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100) || 'vinci-wiki'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const path = String(getQuery(event).path || '')
  if (!path.startsWith('/wiki/') || path.includes('\\') || path.includes('\0')) {
    throw createError({ statusCode: 400, message: 'Wiki 路径无效' })
  }
  const article = await getPublicArticleFromDatabase('wiki', path)
  if (!article) throw createError({ statusCode: 404, message: 'Wiki 页面不存在' })
  try {
    const pdf = await createWikiPdf(article.title, String(article.body || ''))
    setResponseHeader(event, 'content-type', 'application/pdf')
    setResponseHeader(event, 'content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFilename(article.title)}-Pandoc文档版.pdf`)}`)
    setResponseHeader(event, 'cache-control', 'private, no-store')
    return pdf
  } catch {
    throw createError({ statusCode: 503, message: 'PDF 导出服务暂时不可用' })
  }
})
