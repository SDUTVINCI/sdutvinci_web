import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleCreditIdentities,
  articleRevisions,
  articles,
  auditLogs,
  contentReconciliationRequests,
  memberRevisions,
  members,
  users
} from '../server/db/schema'
import {
  ArticleCreditIdentityConflictError,
  createArticleCreditIdentity,
  listCmsArticleCreditIdentities,
  listPublicArticleCreditIdentities,
  updateArticleCreditIdentity
} from '../server/services/article-credit-identities'
import { profileRecord, serializeMemberProfile } from '../server/services/member-profile'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip

suite('文章署名身份', () => {
  let actorUserId = ''

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(`
      truncate table article_credit_identities, content_reconciliation_requests,
      audit_logs, article_revisions, articles, member_revisions, members, users
      restart identity cascade
    `)
    const [actor] = await getDatabase().insert(users).values({
      account: 'creditadmin',
      passwordHash: 'test-only-password-hash'
    }).returning({ id: users.id })
    actorUserId = actor!.id
  })

  afterAll(closeDatabase)

  it('自动生成稳定拼音 ID、显示中文名并排队快照对账', async () => {
    await createArticleCreditIdentity({ displayName: '崔桐汇' }, actorUserId)
    const articleId = randomUUID()
    const revisionId = randomUUID()
    await getDatabase().insert(articles).values({
      id: articleId,
      collection: 'wiki',
      relativePath: 'legacy-credit.md',
      publicPath: '/wiki/legacy-credit',
      directory: '',
      title: '旧中文署名',
      frontmatter: { title: '旧中文署名', authors: ['崔桐汇'] },
      searchText: '旧中文署名',
      contentHash: 'a'.repeat(64)
    })
    await getDatabase().insert(articleRevisions).values({
      id: revisionId,
      articleId,
      revisionNumber: 1,
      markdownSource: '---\ntitle: 旧中文署名\nauthors:\n  - 崔桐汇\n---\n',
      body: '',
      frontmatter: { title: '旧中文署名', authors: ['崔桐汇'] },
      contentHash: 'a'.repeat(64),
      sourceKind: 'backfill'
    })
    await getDatabase().update(articles).set({ currentRevisionId: revisionId })
      .where(eq(articles.id, articleId))

    expect(await listPublicArticleCreditIdentities(['cuitonghui'])).toEqual([{
      memberKey: 'cuitonghui',
      name: '崔桐汇',
      image: null,
      path: null
    }])
    expect(await listCmsArticleCreditIdentities()).toEqual([
      expect.objectContaining({
        creditKey: 'cuitonghui',
        displayName: '崔桐汇',
        usageCount: 1,
        version: 1
      })
    ])
    expect(await getDatabase().select().from(contentReconciliationRequests)).toHaveLength(1)
    expect(await getDatabase().select().from(auditLogs).where(and(
      eq(auditLogs.action, 'article_credit_identity.create'),
      eq(auditLogs.targetId, 'cuitonghui')
    ))).toHaveLength(1)
  })

  it('可关联正式成员并使用成员姓名、头像和主页，更新使用乐观版本', async () => {
    const profile = {
      memberKey: 'officialmember',
      name: '正式成员',
      avatarUrl: '/avatars/official.webp',
      sourcePath: 'cms/officialmember.md',
      role: '成员',
      memberType: '成员',
      groupName: null,
      positions: ['成员'],
      seasons: [],
      advisorSeasons: [],
      grade: null,
      affiliation: null,
      links: {},
      body: '',
      sortOrder: 0,
      metadata: {}
    }
    const serialized = serializeMemberProfile(profile)
    const memberId = randomUUID()
    const revisionId = randomUUID()
    await getDatabase().insert(members).values({
      id: memberId,
      memberKey: profile.memberKey,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      sourcePath: profile.sourcePath,
      role: profile.role,
      memberType: profile.memberType,
      positions: profile.positions
    })
    await getDatabase().insert(memberRevisions).values({
      id: revisionId,
      memberId,
      revisionNumber: 1,
      memberKey: profile.memberKey,
      sourcePath: profile.sourcePath,
      profile: profileRecord(profile),
      markdownSource: serialized.source,
      contentHash: serialized.sha256,
      sourceKind: 'backfill'
    })
    await getDatabase().update(members).set({ currentRevisionId: revisionId })
      .where(eq(members.id, memberId))
    await createArticleCreditIdentity({
      creditKey: 'historiccredit',
      displayName: '历史姓名',
      memberId
    }, actorUserId)
    const updated = await updateArticleCreditIdentity('historiccredit', {
      displayName: '保留的历史姓名',
      memberId,
      expectedVersion: 1
    }, actorUserId)

    expect(updated?.version).toBe(2)
    expect(await listPublicArticleCreditIdentities(['historiccredit'])).toEqual([{
      memberKey: 'historiccredit',
      name: '正式成员',
      image: '/avatars/official.webp',
      path: '/team/officialmember'
    }])
    await expect(updateArticleCreditIdentity('historiccredit', {
      displayName: '冲突更新',
      memberId,
      expectedVersion: 1
    }, actorUserId)).rejects.toBeInstanceOf(ArticleCreditIdentityConflictError)
    expect((await getDatabase().select().from(articleCreditIdentities))[0])
      .toMatchObject({ displayName: '保留的历史姓名', version: 2 })
    expect(await getDatabase().select().from(contentReconciliationRequests)).toHaveLength(1)
  })
})
