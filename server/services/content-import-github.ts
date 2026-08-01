import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { getContentImportConfig, type ContentImportConfig } from '../utils/content-import-config'

export interface GitHubPullRequest {
  number: number
  state: string
  user: { login: string }
  base: { sha: string, ref: string, repo: { full_name: string } }
  head: { sha: string, repo: { full_name: string } | null }
}

export interface GitHubPullFile {
  filename: string
  previous_filename?: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | string
  changes: number
}

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  user: z.object({ login: z.string() }),
  base: z.object({
    sha: z.string(),
    ref: z.string(),
    repo: z.object({ full_name: z.string() })
  }),
  head: z.object({
    sha: z.string(),
    repo: z.object({ full_name: z.string() }).nullable()
  })
})
const pullFilesSchema = z.array(z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  changes: z.number().int().nonnegative()
}))
const contentSchema = z.object({
  type: z.string(),
  size: z.number().int().nonnegative(),
  encoding: z.string().optional(),
  content: z.string().optional(),
  sha: z.string().optional()
})
const commentSchema = z.object({ id: z.number().int().positive() })
const closeSchema = z.object({ state: z.literal('closed') })

export class ContentImportGitHubError extends Error {
  constructor(public readonly code: string, public readonly status = 502) {
    super(code)
  }
}

const pathForApi = (value: string) => value.split('/').map(encodeURIComponent).join('/')

export class ContentImportGitHubClient {
  constructor(
    private readonly config: ContentImportConfig = getContentImportConfig(),
    private readonly requestFetch: typeof fetch = fetch
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/vnd.github+json')
    headers.set('x-github-api-version', '2022-11-28')
    headers.set('user-agent', 'vinci-cms-content-import')
    if (this.config.CONTENT_PR_IMPORT_GITHUB_TOKEN) {
      headers.set('authorization', `Bearer ${this.config.CONTENT_PR_IMPORT_GITHUB_TOKEN}`)
    }
    for (let attempt = 1; attempt <= this.config.CONTENT_PR_IMPORT_RETRY_ATTEMPTS; attempt += 1) {
      let response: Response
      try {
        response = await this.requestFetch(
          `${this.config.CONTENT_PR_IMPORT_API_URL.replace(/\/$/, '')}${path}`,
          { ...init, headers }
        )
      } catch {
        if (attempt === this.config.CONTENT_PR_IMPORT_RETRY_ATTEMPTS) {
          throw new ContentImportGitHubError('GITHUB_NETWORK_FAILED')
        }
        await delay(50 * attempt)
        continue
      }
      if (response.ok) return await response.json() as T
      if ((response.status === 429 || response.status >= 500)
        && attempt < this.config.CONTENT_PR_IMPORT_RETRY_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after') || '0')
        await delay(Math.min(250, Math.max(25, retryAfter * 1000)))
        continue
      }
      throw new ContentImportGitHubError(
        response.status === 404 ? 'GITHUB_RESOURCE_NOT_FOUND' : 'GITHUB_API_FAILED',
        response.status
      )
    }
    throw new ContentImportGitHubError('GITHUB_API_FAILED')
  }

  private validated<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new ContentImportGitHubError('GITHUB_RESPONSE_INVALID', 502)
    return parsed.data
  }

  async getPullRequest(repositoryId: string, number: number) {
    return this.validated(
      pullRequestSchema,
      await this.request<unknown>(`/repos/${repositoryId}/pulls/${number}`)
    ) as GitHubPullRequest
  }

  async listPullFiles(repositoryId: string, number: number) {
    const result: GitHubPullFile[] = []
    for (let page = 1; ; page += 1) {
      const items = this.validated(
        pullFilesSchema,
        await this.request<unknown>(
          `/repos/${repositoryId}/pulls/${number}/files?per_page=100&page=${page}`
        )
      )
      result.push(...items)
      if (result.length > this.config.CONTENT_PR_IMPORT_MAX_FILES) {
        throw new ContentImportGitHubError('GITHUB_PULL_FILE_LIMIT_EXCEEDED', 422)
      }
      if (items.length < 100) return result
    }
  }

  async readFile(repositoryId: string, path: string, commit: string) {
    const item = this.validated(
      contentSchema,
      await this.request<unknown>(
        `/repos/${repositoryId}/contents/${pathForApi(path)}?ref=${encodeURIComponent(commit)}`
      )
    )
    if (item.type !== 'file' || item.encoding !== 'base64' || typeof item.content !== 'string') {
      throw new ContentImportGitHubError('GITHUB_FILE_UNSAFE', 422)
    }
    if (item.size > this.config.CONTENT_PR_IMPORT_MAX_FILE_BYTES) {
      throw new ContentImportGitHubError('GITHUB_FILE_TOO_LARGE', 422)
    }
    const compactContent = item.content.replace(/\s/g, '')
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compactContent)) {
      throw new ContentImportGitHubError('GITHUB_FILE_ENCODING_INVALID', 422)
    }
    const bytes = Buffer.from(compactContent, 'base64')
    if (bytes.length !== item.size || bytes.includes(0)) {
      throw new ContentImportGitHubError('GITHUB_FILE_BINARY', 422)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new ContentImportGitHubError('GITHUB_FILE_ENCODING_INVALID', 422)
    }
  }

  async comment(repositoryId: string, number: number, body: string) {
    return this.validated(
      commentSchema,
      await this.request<unknown>(`/repos/${repositoryId}/issues/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body })
      })
    )
  }

  async close(repositoryId: string, number: number) {
    return this.validated(
      closeSchema,
      await this.request<unknown>(`/repos/${repositoryId}/pulls/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' })
      })
    )
  }
}
