import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { articles, auditLogs, drafts, editLocks } from '../server/db/schema'
import { synchronizeCmsArticles } from '../server/services/cms-articles'
import { bootstrapCmsAdmin, createCmsUser } from '../server/services/cms-auth'
import {
  acquireCmsDraftEditLock,
  CmsEditLockLostError,
  getCmsDraftEditLock,
  heartbeatCmsDraftEditLock,
  releaseCmsDraftEditLock,
  takeoverCmsDraftEditLock
} from '../server/services/cms-edit-locks'
import {
  createCmsDraftForArticle,
  saveCmsDraft
} from '../server/services/cms-drafts'
import { synchronizeCmsMembers } from '../server/services/cms-members'
import {
  approveCmsDraftReview,
  CmsPublishedVersionConflictError,
  getCmsDraftComparison,
  getCmsReviewDetail,
  listCmsDraftReviewEvents,
  listCmsPendingReviews,
  rejectCmsDraftReview,
  reopenCmsDraft,
  resyncCmsDraftBase,
  submitCmsDraftForReview,
  withdrawCmsDraftReview
} from '../server/services/cms-reviews'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip
let contentRoot = ''
let adminUserId = ''
let memberOneUserId = ''
let memberTwoUserId = ''
let articleId = ''
let articlePath = ''

const markdown = (frontmatter: string, body = '') =>
  `---\n${frontmatter.trim()}\n---\n${body}`

const acquireLease = async (draftId: string, userId: string, isAdmin = false) => {
  const result = await acquireCmsDraftEditLock(draftId, userId, isAdmin)
  expect(result.acquired).toBe(true)
  return result.lock.leaseId!
}

integration('CMS 阶段 4 审核、编辑锁与版本冲突', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    contentRoot = await mkdtemp(join(tmpdir(), 'vinci-cms-workflow-'))
    process.env.CMS_CONTENT_ROOT = contentRoot
    await Promise.all(['members', 'news', 'wiki'].map(path =>
      mkdir(join(contentRoot, path), { recursive: true })
    ))
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table article_deletion_events, publish_records, edit_locks, review_events, audit_logs, sessions, draft_authors, drafts, user_members, user_roles, articles, members, users
      restart identity cascade
    `)
    await Promise.all(['members', 'news', 'wiki'].map(async (path) => {
      await rm(join(contentRoot, path), { recursive: true, force: true })
      await mkdir(join(contentRoot, path), { recursive: true })
    }))
    await Promise.all([
      writeFile(
        join(contentRoot, 'members', '管理员.md'),
        markdown('name: 管理员\nid: phaseadmin')
      ),
      writeFile(
        join(contentRoot, 'members', '成员甲.md'),
        markdown('name: 成员甲\nid: memberone')
      ),
      writeFile(
        join(contentRoot, 'members', '成员乙.md'),
        markdown('name: 成员乙\nid: membertwo')
      )
    ])
    const admin = await bootstrapCmsAdmin({
      account: 'phaseadmin',
      password: 'AdminPassword123'
    })
    adminUserId = admin!.id
    const memberOne = await createCmsUser({
      account: 'memberone',
      password: 'MemberPassword123',
      roles: ['member']
    }, adminUserId)
    const memberTwo = await createCmsUser({
      account: 'membertwo',
      password: 'MemberPassword123',
      roles: ['member']
    }, adminUserId)
    memberOneUserId = memberOne!.id
    memberTwoUserId = memberTwo!.id
    await synchronizeCmsMembers(false)

    articlePath = join(contentRoot, 'news', 'workflow.md')
    await writeFile(
      articlePath,
      markdown(
        'title: 正式标题\ndescription: 正式摘要\nauthors:\n  - memberone',
        '正式正文\n'
      )
    )
    await synchronizeCmsArticles()
    const [article] = await getDatabase()
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.relativePath, 'workflow.md'))
      .limit(1)
    articleId = article!.id
  })

  afterAll(async () => {
    await closeDatabase()
    if (contentRoot.startsWith(tmpdir())) {
      await rm(contentRoot, { recursive: true, force: true })
    }
  })

  it('完成提交、撤回、驳回、继续编辑和审核通过状态流，且不写正式 Markdown', async () => {
    const sourceBefore = await readFile(articlePath, 'utf8')
    let draft = await createCmsDraftForArticle(articleId, memberOneUserId)
    let lockLeaseId = await acquireLease(draft.id, memberOneUserId)
    draft = await saveCmsDraft(draft.id, memberOneUserId, {
      title: '待审核标题',
      description: '待审核摘要',
      body: '待审核正文\n',
      authorKeys: ['memberone'],
      version: draft.version,
      lockLeaseId
    })
    draft = (await submitCmsDraftForReview(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!
    expect(draft.status).toBe('pending_review')
    expect((await listCmsPendingReviews()).map(item => item.id)).toContain(draft.id)
    expect(await getCmsDraftEditLock(draft.id, memberOneUserId, false)).toBeNull()

    draft = (await withdrawCmsDraftReview(
      draft.id,
      memberOneUserId,
      draft.version
    ))!
    expect(draft.status).toBe('withdrawn')

    lockLeaseId = await acquireLease(draft.id, memberOneUserId)
    draft = (await reopenCmsDraft(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!
    draft = await saveCmsDraft(draft.id, memberOneUserId, {
      title: draft.title,
      description: draft.description,
      body: '按撤回意见修改后的正文\n',
      authorKeys: ['memberone'],
      version: draft.version,
      lockLeaseId
    })
    draft = (await submitCmsDraftForReview(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!
    draft = (await rejectCmsDraftReview(draft.id, adminUserId, {
      version: draft.version,
      reason: '请补充测试数据。'
    }))!
    expect(draft.status).toBe('rejected')
    expect((await listCmsDraftReviewEvents(draft.id))[0]).toMatchObject({
      action: 'rejected',
      reason: '请补充测试数据。'
    })

    lockLeaseId = await acquireLease(draft.id, memberOneUserId)
    draft = (await reopenCmsDraft(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!
    draft = (await submitCmsDraftForReview(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!
    draft = (await approveCmsDraftReview(
      draft.id,
      adminUserId,
      draft.version
    ))!
    expect(draft.status).toBe('approved')
    expect((await getCmsReviewDetail(draft.id)).events.map(event => event.action))
      .toEqual(expect.arrayContaining([
        'submitted',
        'withdrawn',
        'reopened',
        'rejected',
        'approved'
      ]))
    expect(await readFile(articlePath, 'utf8')).toBe(sourceBefore)
  })

  it('阻止两个用户同时编辑，支持管理员接管、正常释放和超时释放', async () => {
    const firstDraft = await createCmsDraftForArticle(articleId, memberOneUserId)
    const secondDraft = await createCmsDraftForArticle(articleId, memberTwoUserId)
    const firstLease = await acquireLease(firstDraft.id, memberOneUserId)

    const blocked = await acquireCmsDraftEditLock(
      secondDraft.id,
      memberTwoUserId,
      false
    )
    expect(blocked).toMatchObject({
      acquired: false,
      lock: {
        holder: { userId: memberOneUserId },
        heldByCurrentUser: false,
        leaseId: null
      }
    })

    const takeover = await takeoverCmsDraftEditLock(
      secondDraft.id,
      adminUserId,
      '原编辑者无法释放锁'
    )
    expect(takeover.lock.holder.userId).toBe(adminUserId)
    await expect(heartbeatCmsDraftEditLock(
      firstDraft.id,
      memberOneUserId,
      firstLease
    )).rejects.toBeInstanceOf(CmsEditLockLostError)
    const [takeoverAudit] = await getDatabase()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'edit_lock.takeover'))
    expect(takeoverAudit).toMatchObject({
      action: 'edit_lock.takeover',
      metadata: {
        previousHolderUserId: memberOneUserId,
        newHolderUserId: adminUserId
      }
    })

    await getDatabase()
      .update(editLocks)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(editLocks.leaseId, takeover.lock.leaseId!))
    const afterTimeout = await acquireCmsDraftEditLock(
      secondDraft.id,
      memberTwoUserId,
      false
    )
    expect(afterTimeout.acquired).toBe(true)
    expect(await releaseCmsDraftEditLock(
      secondDraft.id,
      memberTwoUserId,
      afterTimeout.lock.leaseId!
    )).toBe(true)
    expect(await getCmsDraftEditLock(
      secondDraft.id,
      memberTwoUserId,
      false
    )).toBeNull()
  })

  it('使用正式 Markdown 实时哈希阻止过期草稿，并允许显式手动重新同步', async () => {
    let draft = await createCmsDraftForArticle(articleId, memberOneUserId)
    const lockLeaseId = await acquireLease(draft.id, memberOneUserId)
    const editedBody = '用户手动整理的草稿正文\n'
    draft = await saveCmsDraft(draft.id, memberOneUserId, {
      title: draft.title,
      description: draft.description,
      body: editedBody,
      authorKeys: ['memberone'],
      version: draft.version,
      lockLeaseId
    })
    await writeFile(
      articlePath,
      markdown(
        'title: 他人更新后的正式标题\ndescription: 新摘要\nauthors:\n  - membertwo',
        '他人发布的新正文\n'
      )
    )

    await expect(submitCmsDraftForReview(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    })).rejects.toBeInstanceOf(CmsPublishedVersionConflictError)
    let comparison = await getCmsDraftComparison(draft.id)
    expect(comparison.hasVersionConflict).toBe(true)
    expect(comparison.currentContentHash).not.toBe(draft.baseContentHash)
    expect(comparison.draft.body).toBe(editedBody)

    draft = (await resyncCmsDraftBase(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId,
      expectedCurrentContentHash: comparison.currentContentHash!
    }))!
    expect(draft.baseContentHash).toBe(comparison.currentContentHash)
    expect(draft.body).toBe(editedBody)
    draft = (await submitCmsDraftForReview(draft.id, memberOneUserId, {
      version: draft.version,
      lockLeaseId
    }))!

    await writeFile(
      articlePath,
      markdown('title: 审核期间再次更新\nauthors:\n  - membertwo', '第三版正式正文\n')
    )
    await expect(approveCmsDraftReview(
      draft.id,
      adminUserId,
      draft.version
    )).rejects.toBeInstanceOf(CmsPublishedVersionConflictError)
    const [row] = await getDatabase()
      .select({ status: drafts.status })
      .from(drafts)
      .where(eq(drafts.id, draft.id))
    expect(row?.status).toBe('pending_review')
    comparison = await getCmsDraftComparison(draft.id)
    expect(comparison.hasVersionConflict).toBe(true)
  })
})
