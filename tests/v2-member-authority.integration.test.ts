import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { auditLogs, contentExportJobs, memberProposals, memberRevisions, members, userMembers, users } from '../server/db/schema'
import {
  applyCmsMemberMarkdownMigration,
  applyCurrentMemberFrontmatterNormalization,
  applyMemberProposal,
  createCmsMember,
  deleteCmsMember,
  listCmsMembers,
  listPendingMemberProposalsForReview,
  planCmsMemberMarkdownMigration,
  planCurrentMemberFrontmatterNormalization,
  rejectMemberProposal,
  restoreCmsMemberRevision,
  updateCmsMember
} from '../server/services/cms-members'
import { sha256ContentBytes } from '../server/services/content-export-serialization'
import { bootstrapCmsAdmin, createCmsUser } from '../server/services/cms-auth'
import { getPublicMemberFromDatabase, listPublicMembersFromDatabase } from '../server/services/public-content'
import { loadDatabaseContentExportSnapshot } from '../server/services/content-export-snapshot'
import { listPublicArticleCreditIdentities } from '../server/services/article-credit-identities'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const suite = configureCmsTestDatabase() ? describe : describe.skip

suite('V2 阶段 9 成员数据库权威与迁移', () => {
  let fixtureRoot = ''

  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET = 'phase-9-test-secret-with-at-least-32-characters'
    fixtureRoot = await mkdtemp(join(tmpdir(), 'vinci-v2-phase9-members-test-'))
    const memberRoot = join(fixtureRoot, 'members', 'test')
    await mkdir(memberRoot, { recursive: true })
    for (let index = 1; index <= 32; index += 1) {
      const key = `member${String(index).padStart(3, '0')}`
      await writeFile(join(memberRoot, `${key}.md`), [
        '---',
        `id: ${key}`,
        `name: 阶段九夹具成员 ${index}`,
        'image: /images/logo.png',
        `role: ${index % 2 ? '控制组' : '机械组'}`,
        `type: ${index === 1 ? '团队负责人' : '队员'}`,
        `time: ${2022 + (index % 5)}`,
        `grade: ${2021 + (index % 5)}`,
        'affiliation: Vinci',
        'links:',
        `  homepage: https://example.test/${key}`,
        '---',
        `阶段九隔离数据库成员正文 ${index}`,
        ''
      ].join('\n'))
    }
    process.env.CMS_CONTENT_ROOT = fixtureRoot
    await runMigrations()
  })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table audit_logs, content_export_jobs, member_proposals, member_revisions, user_members, user_roles, sessions, members, users restart identity cascade`)
  })
  afterAll(async () => {
    await closeDatabase()
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  it('dry-run 对账 32 份资料并可重入地保留 ID、建立 Revision 与 Outbox', async () => {
    const plan = await planCmsMemberMarkdownMigration()
    expect(plan.markdownCount).toBe(32)
    expect(plan.blockers).toEqual([])
    await applyCmsMemberMarkdownMigration()
    const first = await listCmsMembers()
    expect(first).toHaveLength(32)
    expect(first.every(item => item.currentRevisionId && item.version === 1)).toBe(true)
    for (const source of plan.scanned) {
      expect(first.find(item => item.memberKey === source.profile.memberKey)).toMatchObject({
        name: source.profile.name, avatarUrl: source.profile.avatarUrl,
        seasons: source.profile.seasons, advisorSeasons: source.profile.advisorSeasons,
        role: source.profile.role, memberType: source.profile.memberType,
        sortOrder: source.profile.sortOrder, metadata: source.profile.metadata
      })
    }
    expect(await getDatabase().select().from(memberRevisions)).toHaveLength(32)
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(32)
    const snapshot = await loadDatabaseContentExportSnapshot()
    expect(snapshot.activeMemberItems).toHaveLength(32)
    expect(JSON.parse(snapshot.metadata.snapshotSource).members).toHaveLength(32)
    const ids = new Map(first.map(item => [item.memberKey, item.id]))
    await applyCmsMemberMarkdownMigration()
    expect(new Map((await listCmsMembers()).map(item => [item.memberKey, item.id]))).toEqual(ids)
    expect(await getDatabase().select().from(memberRevisions)).toHaveLength(32)
  })

  it('升级旧 members 行时保留全部既有 UUID', async () => {
    const plan = await planCmsMemberMarkdownMigration()
    const fixedIds = new Map(plan.scanned.map(item => [item.profile.memberKey, randomUUID()]))
    await getDatabase().insert(members).values(plan.scanned.map(item => ({
      id: fixedIds.get(item.profile.memberKey)!, memberKey: item.profile.memberKey,
      name: item.profile.name, sourcePath: item.profile.sourcePath
    })))
    await applyCmsMemberMarkdownMigration()
    expect(new Map((await listCmsMembers()).map(item => [item.memberKey, item.id]))).toEqual(fixedIds)
  })

  it('CMS 更新只写数据库、使用乐观锁并生成可恢复的新 Revision', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'phaseadmin', password: 'AdminPassword123' })
    const created = await createCmsMember({ memberKey: 'memberone', name: 'One', role: 'Member', body: 'original' }, admin!.id)
    const updated = await updateCmsMember(created!.id, {
      name: 'One Updated', positions: ['队长'], body: 'changed', expectedVersion: 1
    }, admin!.id)
    expect(updated).toMatchObject({ version: 2, role: '队长', body: 'changed' })
    await expect(updateCmsMember(created!.id, { name: 'stale', expectedVersion: 1 }, admin!.id))
      .rejects.toThrow('成员资料已被其他操作更新')
    const revisions = await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.memberId, created!.id))
    expect(revisions).toHaveLength(2)
    const restored = await restoreCmsMemberRevision(created!.id, revisions.find(item => item.revisionNumber === 1)!.id, 2, admin!.id)
    expect(restored).toMatchObject({ version: 3, name: 'One', body: 'original' })
    expect(await getDatabase().select().from(contentExportJobs).where(eq(contentExportJobs.targetId, created!.id))).toHaveLength(3)
  })

  it('旧 17 届次不阻碍王骁增加 26、27；统一 frontmatter 保留旧指导老师资料', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'normalizeadmin', password: 'AdminPassword123' })
    const student = await createCmsMember({
      memberKey: 'wangxiao', name: '王虓', grade: '2016', groupName: '机械组',
      positions: ['成员'], seasons: ['18'], advisorSeasons: ['18', '19']
    }, admin!.id)
    await getDatabase().update(members).set({ advisorSeasons: ['17', '18', '19'] }).where(eq(members.id, student!.id))
    const updated = await updateCmsMember(student!.id, {
      name: '王虓', advisorSeasons: ['17', '18', '19', '26', '27'], expectedVersion: student!.version
    }, admin!.id)
    expect(updated?.advisorSeasons).toEqual(['17', '18', '19', '26', '27'])

    const teacher = await createCmsMember({
      memberKey: 'oldteacher', name: '旧指导老师', positions: ['指导老师'], grade: null
    }, admin!.id)
    const oldSource = '---\nid: oldteacher\nname: 旧指导老师\nrole: 指导老师，教授\ntype: 指导老师\ntime: 16,17\nadvisor: null\ngrade: null\n---\n'
    await getDatabase().update(members).set({
      role: '指导老师，教授', seasons: ['16', '17'], advisorSeasons: []
    }).where(eq(members.id, teacher!.id))
    await getDatabase().update(memberRevisions).set({
      markdownSource: oldSource, contentHash: sha256ContentBytes(oldSource)
    }).where(eq(memberRevisions.id, teacher!.currentRevisionId!))

    const plan = await planCurrentMemberFrontmatterNormalization()
    expect(plan.items.find(item => item.memberKey === 'oldteacher')?.moveTeacherSeasons).toBe(true)
    const applied = await applyCurrentMemberFrontmatterNormalization()
    expect(applied.changes).toBeGreaterThanOrEqual(1)
    const [after] = await getDatabase().select().from(members).where(eq(members.id, teacher!.id))
    expect(after).toMatchObject({ id: teacher!.id, role: '指导老师，教授', seasons: [], advisorSeasons: ['16', '17'] })
    const [revision] = await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.id, after!.currentRevisionId!))
    expect(revision?.markdownSource).toContain('schemaVersion: 2')
    expect(revision?.markdownSource).toContain('isTeacher: true')
    expect((await applyCurrentMemberFrontmatterNormalization()).changes).toBe(0)
  })

  it('审核中心列出资料修改提案，并安全合并旧版本提案或拒绝', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'proposaladmin', password: 'AdminPassword123' })
    const member = await createCmsMember({ memberKey: 'proposalmember', name: '原姓名', body: '原简介' }, admin!.id)
    const [base] = await getDatabase().select().from(memberRevisions)
      .where(eq(memberRevisions.id, member!.currentRevisionId!))
    const [proposal] = await getDatabase().insert(memberProposals).values({
      memberId: member!.id, baseRevisionId: base!.id, currentRevisionId: base!.id,
      action: 'update', proposedProfile: { ...base!.profile, body: '提议的新简介' },
      fieldChanges: { body: { from: '原简介', to: '提议的新简介' } }
    }).returning()
    await updateCmsMember(member!.id, { name: '当前姓名', expectedVersion: member!.version }, admin!.id)
    expect((await listPendingMemberProposalsForReview())[0]).toMatchObject({
      id: proposal!.id, needsMerge: true, member: { name: '当前姓名', version: 2 }
    })
    const accepted = await applyMemberProposal(proposal!.id, 2, 'APPLY_MEMBER_PROPOSAL', admin!.id)
    expect(accepted.member).toMatchObject({ name: '当前姓名', body: '提议的新简介', version: 3 })
    expect(await listPendingMemberProposalsForReview()).toEqual([])

    const [acceptedRevision] = await getDatabase().select().from(memberRevisions)
      .where(eq(memberRevisions.id, accepted.member!.currentRevisionId!))
    const [conflicting] = await getDatabase().insert(memberProposals).values({
      memberId: member!.id, baseRevisionId: acceptedRevision!.id, currentRevisionId: acceptedRevision!.id,
      action: 'update', proposedProfile: { ...acceptedRevision!.profile, body: '另一份提议' },
      fieldChanges: { body: { from: '提议的新简介', to: '另一份提议' } }
    }).returning()
    await updateCmsMember(member!.id, { name: '当前姓名', body: '更近的修改', expectedVersion: 3 }, admin!.id)
    await expect(applyMemberProposal(conflicting!.id, 4, 'APPLY_MEMBER_PROPOSAL', admin!.id))
      .rejects.toThrow('字段冲突')
    expect((await listCmsMembers())[0]?.body).toBe('更近的修改')
    await rejectMemberProposal(conflicting!.id, '已冲突', admin!.id)

    const [rejected] = await getDatabase().insert(memberProposals).values({
      memberId: member!.id, baseRevisionId: base!.id,
      currentRevisionId: accepted.member!.currentRevisionId!, action: 'delete', fieldChanges: {}
    }).returning()
    await rejectMemberProposal(rejected!.id, '资料仍需保留', admin!.id)
    expect((await getDatabase().select().from(memberProposals).where(eq(memberProposals.id, rejected!.id)))[0]?.status).toBe('rejected')
  })

  it('删除成员使用乐观锁软删除并生成 Git 删除 Outbox', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'deleteadmin', password: 'AdminPassword123' })
    await createCmsUser({ account: 'memberdelete', password: 'MemberDeletePassword123!', roles: ['member'] }, admin!.id)
    const created = await createCmsMember({
      memberKey: 'memberdelete', name: 'Delete Me', body: 'preserved history'
    }, admin!.id)
    expect(await getDatabase().select().from(userMembers)).toHaveLength(1)

    await expect(deleteCmsMember(created!.id, 99, admin!.id))
      .rejects.toThrow('成员资料已被其他操作更新')
    const deleted = await deleteCmsMember(created!.id, 1, admin!.id)
    expect(deleted).toMatchObject({ version: 2, deletedAt: expect.any(String) })
    expect(await listCmsMembers()).toHaveLength(0)
    expect(await listCmsMembers(true)).toEqual([
      expect.objectContaining({ id: created!.id, deletedAt: expect.any(String) })
    ])
    expect(await listPublicMembersFromDatabase()).toHaveLength(0)
    expect(await getPublicMemberFromDatabase('memberdelete')).toBeNull()
    expect(await getDatabase().select().from(userMembers).where(eq(userMembers.memberId, created!.id))).toHaveLength(0)
    const revisions = await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.memberId, created!.id))
    expect(revisions.map(item => item.sourceKind)).toEqual(['cms_create', 'delete'])
    const jobs = await getDatabase().select().from(contentExportJobs).where(eq(contentExportJobs.targetId, created!.id))
    expect(jobs.map(item => item.operation)).toEqual(['create', 'delete'])
    const audit = await getDatabase().select().from(auditLogs).where(eq(auditLogs.action, 'member.delete'))
    expect(audit).toHaveLength(1)
    const replacement = await createCmsMember({ memberKey: 'memberdelete', name: 'Corrected Member' }, admin!.id)
    expect(replacement).toMatchObject({ memberKey: 'memberdelete', linkedAccount: 'memberdelete' })
    expect(replacement!.sourcePath).not.toBe(created!.sourcePath)
  })

  it('同 ID 账号自动关联，公开列表/详情读取数据库资料', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'phaseadmin', password: 'AdminPassword123' })
    const created = await createCmsMember({
      memberKey: 'membertwo', name: 'Two', seasons: ['2025'], advisorSeasons: ['2026'],
      affiliation: 'Vinci', links: { github: 'https://github.com/example' }, body: 'database body'
    }, admin!.id)
    await createCmsUser({ account: 'membertwo', password: 'MemberTwoPassword123!', roles: ['member'] }, admin!.id)
    expect(await getDatabase().select().from(userMembers)).toHaveLength(1)
    const detail = await getPublicMemberFromDatabase('membertwo')
    expect(detail).toMatchObject({ name: 'Two', time: '2025', advisor: '2026', body: 'database body' })
    expect(await listPublicMembersFromDatabase()).toHaveLength(1)
    expect((await getDatabase().select().from(userMembers))[0]?.memberId).toBe(created!.id)
  })

  it('已删除档案释放 ID，修改稳定 ID 时关联已有同名账号并保留旧版本', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'renameadmin', password: 'AdminPassword123' })
    const old = await createCmsMember({ memberKey: 'duanquanyu', name: '段泉宇旧档案' }, admin!.id)
    await deleteCmsMember(old!.id, old!.version, admin!.id)
    const account = await createCmsUser({ account: 'duanquanyu', password: 'DuanQuanyuPassword123!', roles: ['member'] }, admin!.id)
    const current = await createCmsMember({ memberKey: 'duanquanyu2', name: '段泉宇' }, admin!.id)
    const renamed = await updateCmsMember(current!.id, {
      memberKey: 'duanquanyu', name: '段泉宇', expectedVersion: current!.version
    }, admin!.id)
    expect(renamed).toMatchObject({ memberKey: 'duanquanyu', linkedUserId: account!.id, linkedAccount: 'duanquanyu', version: 2 })
    expect((await getPublicMemberFromDatabase('duanquanyu'))?.id).toBe('duanquanyu')
    expect((await getPublicMemberFromDatabase('duanquanyu2'))?.id).toBe('duanquanyu')
    expect((await getDatabase().select().from(members).where(eq(members.id, old!.id)))[0]?.memberKey).toBe('duanquanyu')
    const revisions = await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.memberId, current!.id))
    expect(revisions.map(row => row.memberKey)).toEqual(['duanquanyu2', 'duanquanyu'])
    expect(await listPublicArticleCreditIdentities(['duanquanyu2'])).toEqual([
      expect.objectContaining({ memberKey: 'duanquanyu2', path: '/team/duanquanyu' })
    ])
    const restored = await restoreCmsMemberRevision(current!.id, revisions[0]!.id, renamed!.version, admin!.id)
    expect(restored).toMatchObject({ memberKey: 'duanquanyu', version: 3 })
    const oldRevision = (await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.memberId, old!.id)))[0]!
    await expect(restoreCmsMemberRevision(old!.id, oldRevision.id, 2, admin!.id))
      .rejects.toThrow('该稳定 ID 已由其他有效成员使用')
    expect((await getDatabase().select().from(users).where(eq(users.id, account!.id)))[0]?.account).toBe('duanquanyu')
  })

  it('修改已有成员稳定 ID 时同步修改其账号 ID', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'renameadmin', password: 'AdminPassword123' })
    const member = await createCmsMember({ memberKey: 'oldmember', name: 'Old Member' }, admin!.id)
    const account = await createCmsUser({ account: 'oldmember', password: 'OldMemberPassword123!', roles: ['member'] }, admin!.id)
    const updated = await updateCmsMember(member!.id, { memberKey: 'newmember', name: 'Old Member', expectedVersion: 1 }, admin!.id)
    expect(updated).toMatchObject({ memberKey: 'newmember', linkedAccount: 'newmember', linkedUserId: account!.id })
    expect((await getDatabase().select().from(users).where(eq(users.id, account!.id)))[0]?.account).toBe('newmember')
  })

  it('不会把数据库中额外成员静默丢失到 Markdown 迁移之外', async () => {
    await getDatabase().insert(members).values({ id: randomUUID(), memberKey: 'extraone', name: 'Extra' })
    const plan = await planCmsMemberMarkdownMigration()
    expect(plan.blockers).toContain('DATABASE_MEMBER_NOT_IN_MARKDOWN:extraone')
    await expect(applyCmsMemberMarkdownMigration()).rejects.toThrow('MEMBER_MIGRATION_RECONCILIATION_FAILED')
  })
})
