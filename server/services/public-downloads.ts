const alistOrigin = 'https://dl.sdutvinci.cn'
const publishedRoot = '/vdl'
const pageSize = 200

type AListEntry = {
  name?: unknown
  is_dir?: unknown
  size?: unknown
  modified?: unknown
}

type AListListResponse = {
  code?: unknown
  message?: unknown
  data?: {
    content?: unknown
    total?: unknown
    has_more?: unknown
  }
}

export class PublicDownloadsError extends Error {
  constructor(message: string, public statusCode = 502) {
    super(message)
  }
}

const safeSegment = (value: string) => value.length > 0
  && value !== '.'
  && value !== '..'
  && !/[\\/\u0000-\u001f\u007f]/u.test(value)

export const parsePublicDownloadPath = (value: unknown): string[] => {
  if (value === undefined || value === '') return []
  if (typeof value !== 'string' || value.length > 500 || value.startsWith('/')) {
    throw new PublicDownloadsError('无效的资料目录', 400)
  }
  const segments = value.split('/')
  if (segments.length > 12 || segments.some(segment => !safeSegment(segment))) {
    throw new PublicDownloadsError('无效的资料目录', 400)
  }
  return segments
}

const directUrl = (segments: string[]) =>
  `${alistOrigin}/d${publishedRoot}/${segments.map(encodeURIComponent).join('/')}`

export const listPublicDownloads = async (
  path: unknown,
  page: unknown,
  request: typeof fetch = fetch
) => {
  const segments = parsePublicDownloadPath(path)
  const pageNumber = page === undefined ? 1 : Number(page)
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100) {
    throw new PublicDownloadsError('无效的页码', 400)
  }

  let response: Response
  try {
    response = await request(`${alistOrigin}/api/fs/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: [publishedRoot, ...segments].join('/'),
        password: '',
        page: pageNumber,
        per_page: pageSize,
        refresh: false
      }),
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    throw new PublicDownloadsError('下载站暂时无法连接，请稍后重试')
  }
  if (response.status === 401 || response.status === 403) {
    throw new PublicDownloadsError('资料目录尚未开放访客读取', 503)
  }
  if (!response.ok) throw new PublicDownloadsError('下载站暂时无法读取，请稍后重试')

  let result: AListListResponse
  try {
    result = await response.json() as AListListResponse
  } catch {
    throw new PublicDownloadsError('下载站返回的数据无法读取')
  }
  if (!result || typeof result !== 'object') {
    throw new PublicDownloadsError('下载站返回的数据无法读取')
  }
  if (result.code === 401 || result.code === 403) {
    throw new PublicDownloadsError('资料目录尚未开放访客读取', 503)
  }
  if (result.code !== 200 || !Array.isArray(result.data?.content)) {
    throw new PublicDownloadsError('资料目录暂时无法读取，请稍后重试')
  }

  const entries = (result.data.content as AListEntry[])
    .filter(entry => entry && typeof entry === 'object'
      && typeof entry.name === 'string' && safeSegment(entry.name))
    .map(entry => {
      const name = entry.name as string
      const isDirectory = entry.is_dir === true
      return {
        name,
        isDirectory,
        size: typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0
          ? entry.size : 0,
        modified: typeof entry.modified === 'string' ? entry.modified : null,
        path: [...segments, name].join('/'),
        downloadUrl: isDirectory ? null : directUrl([...segments, name])
      }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      if (!a.isDirectory && a.modified && b.modified) return b.modified.localeCompare(a.modified)
      return a.name.localeCompare(b.name, 'zh-CN')
    })

  const total = typeof result.data.total === 'number' && Number.isFinite(result.data.total)
    ? result.data.total : entries.length
  return {
    path: segments.join('/'),
    page: pageNumber,
    total,
    hasMore: typeof result.data.has_more === 'boolean'
      ? result.data.has_more : pageNumber * pageSize < total,
    entries
  }
}
