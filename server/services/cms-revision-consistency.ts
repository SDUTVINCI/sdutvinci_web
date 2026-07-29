import { createHash } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import {
  articleRevisions,
  articles,
  publishRecords
} from '../db/schema'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import { assertCmsRevisionShadowEnabled } from '../utils/cms-v2-flags'
import {
  prepareCmsGitWorktree,
  runCmsGit,
  runCmsGitRaw,
  withCmsPublishLock
} from './cms-git-worktree'

const sha256 = (source: string) =>
  createHash('sha256').update(source).digest('hex')

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : []

const equalStrings = (left: string[], right: string[]) =>
  left.length === right.length
  && left.every((value, index) => value === right[index])

export interface CmsRevisionConsistencyCheck {
  revisionId: string
  revisionNumber: number
  sourceKind: string
  gitCommitHash: string | null
  matchedGitCommitHash: string | null
  inferredGitMatch: boolean
  checks: {
    publicationTime: boolean | null
    authors: boolean
    publisher: boolean | null
    reviewer: boolean | null
    sourceDraft: boolean | null
    body: boolean
    hash: boolean
  }
  matches: boolean
  notes: string[]
}

export interface CmsRevisionConsistencyArticleReport {
  articleId: string
  articlePath: string
  revisionCount: number
  gitCommitCount: number
  checks: CmsRevisionConsistencyCheck[]
  unmatchedGitCommits: string[]
}

export interface CmsRevisionConsistencyReport {
  mode: 'read_only'
  generatedAt: string
  articleCount: number
  revisionCount: number
  mismatchCount: number
  unmatchedGitCommitCount: number
  articles: CmsRevisionConsistencyArticleReport[]
}

const readGitSource = async (gitPath: string, commit: string) => {
  try {
    return await runCmsGitRaw(['show', `${commit}:${gitPath}`])
  } catch {
    return null
  }
}

const readGitCommitMetadata = async (commit: string) => {
  const value = await runCmsGit(['show', '-s', '--format=%aI%x1f%an', commit])
  const [authoredAt, authorName] = value.split('\u001f')
  return {
    authoredAt: authoredAt || '',
    authorName: authorName || ''
  }
}

export const compareCmsGitAndRevisions = async (
  articleId?: string
): Promise<CmsRevisionConsistencyReport> => {
  assertCmsRevisionShadowEnabled()
  const db = getDatabase()
  const articleRows = await db
    .select()
    .from(articles)
    .where(articleId ? eq(articles.id, articleId) : undefined)
    .orderBy(asc(articles.collection), asc(articles.relativePath))
  const revisionRows = articleRows.length
    ? await db
        .select()
        .from(articleRevisions)
        .where(inArray(articleRevisions.articleId, articleRows.map(row => row.id)))
        .orderBy(
          asc(articleRevisions.articleId),
          asc(articleRevisions.revisionNumber)
        )
    : []
  const operationIds = revisionRows
    .map(row => row.sourceOperationId)
    .filter((value): value is string => Boolean(value))
  const operationRows = operationIds.length
    ? await db
        .select()
        .from(publishRecords)
        .where(inArray(publishRecords.id, operationIds))
    : []
  const operations = new Map(operationRows.map(row => [row.id, row]))

  const reports = await withCmsPublishLock(async () => {
    await prepareCmsGitWorktree()
    const articleReports: CmsRevisionConsistencyArticleReport[] = []
    for (const article of articleRows) {
      const gitPath = `content/${article.collection}/${article.relativePath}`
      const gitCommits = (await runCmsGit([
        'log',
        '--follow',
        '--format=%H',
        '--',
        gitPath
      ])).split('\n').map(value => value.trim()).filter(Boolean)
      const sourceCache = new Map<string, string | null>()
      const sourceAt = async (commit: string) => {
        if (!sourceCache.has(commit)) {
          sourceCache.set(commit, await readGitSource(gitPath, commit))
        }
        return sourceCache.get(commit) || null
      }
      const matchedGitCommits = new Set<string>()
      const revisions = revisionRows.filter(row => row.articleId === article.id)
      const explicitlyMatchedGitCommits = new Set(
        revisions
          .map(revision => revision.gitCommitHash)
          .filter((value): value is string => Boolean(value))
      )
      const checks: CmsRevisionConsistencyCheck[] = []
      for (const revision of revisions) {
        let matchedCommit = revision.gitCommitHash
        let inferredGitMatch = false
        if (!matchedCommit) {
          for (const commit of gitCommits) {
            if (
              explicitlyMatchedGitCommits.has(commit)
              || matchedGitCommits.has(commit)
            ) {
              continue
            }
            const candidate = await sourceAt(commit)
            if (
              candidate
              && sha256(candidate) === revision.contentHash
              && candidate === revision.markdownSource
            ) {
              matchedCommit = commit
              inferredGitMatch = true
              break
            }
          }
        }
        const gitSource = matchedCommit
          ? await sourceAt(matchedCommit)
          : null
        const parsed = gitSource ? parseCmsMarkdown(gitSource) : null
        const operation = revision.sourceOperationId
          ? operations.get(revision.sourceOperationId)
          : null
        const notes: string[] = []
        if (!matchedCommit) notes.push('没有找到对应 Git 提交')
        if (matchedCommit && !gitSource) notes.push('对应 Git 提交中不存在文章文件')
        if (matchedCommit) matchedGitCommits.add(matchedCommit)
        const metadata = matchedCommit
          ? await readGitCommitMetadata(matchedCommit)
          : null
        const publicationTime = revision.sourceKind === 'backfill'
          ? null
          : Boolean(
              metadata
              && Math.abs(
                revision.createdAt.getTime()
                - new Date(metadata.authoredAt).getTime()
              ) <= 5_000
            )
        const authors = Boolean(parsed) && equalStrings(
          stringArray(revision.frontmatter.authors),
          stringArray(parsed!.frontmatter.authors)
        )
        const publisher = operation
          ? revision.publishedByUserId === operation.operatorUserId
          : revision.sourceKind === 'backfill' ? null : false
        const reviewer = operation
          ? revision.reviewedByUserId === operation.reviewerUserId
          : revision.sourceKind === 'backfill' ? null : false
        const sourceDraft = operation
          ? revision.sourceDraftId === operation.draftId
          : revision.sourceKind === 'backfill' ? null : false
        const body = Boolean(parsed) && parsed!.body === revision.body
        const hash = Boolean(gitSource)
          && sha256(gitSource!) === revision.contentHash
          && gitSource === revision.markdownSource
        const fieldChecks = {
          publicationTime,
          authors,
          publisher,
          reviewer,
          sourceDraft,
          body,
          hash
        }
        const matches = Object.values(fieldChecks)
          .every(value => value === null || value === true)
        checks.push({
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          sourceKind: revision.sourceKind,
          gitCommitHash: revision.gitCommitHash,
          matchedGitCommitHash: matchedCommit,
          inferredGitMatch,
          checks: fieldChecks,
          matches,
          notes
        })
      }
      articleReports.push({
        articleId: article.id,
        articlePath: `${article.collection}/${article.relativePath}`,
        revisionCount: revisions.length,
        gitCommitCount: gitCommits.length,
        checks,
        unmatchedGitCommits: gitCommits.filter(
          commit => !matchedGitCommits.has(commit)
        )
      })
    }
    return articleReports
  })
  return {
    mode: 'read_only',
    generatedAt: new Date().toISOString(),
    articleCount: reports.length,
    revisionCount: reports.reduce(
      (total, report) => total + report.revisionCount,
      0
    ),
    mismatchCount: reports.reduce(
      (total, report) =>
        total + report.checks.filter(check => !check.matches).length,
      0
    ),
    unmatchedGitCommitCount: reports.reduce(
      (total, report) => total + report.unmatchedGitCommits.length,
      0
    ),
    articles: reports
  }
}
