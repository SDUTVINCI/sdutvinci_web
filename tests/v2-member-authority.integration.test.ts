import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { auditLogs, contentExportJobs, memberRevisions, members, userMembers } from '../server/db/schema'
import {
  applyCmsMemberMarkdownMigration,
  bindCmsMemberAccount,
  createCmsMember,
  listCmsMembers,
  planCmsMemberMarkdownMigration,
  restoreCmsMemberRevision,
  updateCmsMember
} from '../server/services/cms-members'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import { getPublicMemberFromDatabase, listPublicMembersFromDatabase } from '../server/services/public-content'
import { loadDatabaseContentExportSnapshot } from '../server/services/content-export-snapshot'
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

  it('账号绑定保持独立且公开列表/详情完全读取数据库字段', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'phaseadmin', password: 'AdminPassword123' })
    const created = await createCmsMember({
      memberKey: 'membertwo', name: 'Two', seasons: ['2025'], advisorSeasons: ['2026'],
      affiliation: 'Vinci', links: { github: 'https://github.com/example' }, body: 'database body'
    }, admin!.id)
    await bindCmsMemberAccount(created!.id, admin!.id, admin!.id)
    expect(await getDatabase().select().from(userMembers)).toHaveLength(1)
    const detail = await getPublicMemberFromDatabase('membertwo')
    expect(detail).toMatchObject({ name: 'Two', time: '2025', advisor: '2026', body: 'database body' })
    expect(await listPublicMembersFromDatabase()).toHaveLength(1)
    const audit = await getDatabase().select().from(auditLogs)
    expect(audit.some(item => item.action === 'member.binding.update')).toBe(true)
  })

  it('不会把数据库中额外成员静默丢失到 Markdown 迁移之外', async () => {
    await getDatabase().insert(members).values({ id: randomUUID(), memberKey: 'extraone', name: 'Extra' })
    const plan = await planCmsMemberMarkdownMigration()
    expect(plan.blockers).toContain('DATABASE_MEMBER_NOT_IN_MARKDOWN:extraone')
    await expect(applyCmsMemberMarkdownMigration()).rejects.toThrow('MEMBER_MIGRATION_RECONCILIATION_FAILED')
  })
})
