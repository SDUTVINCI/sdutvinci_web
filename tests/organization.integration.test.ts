import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import {
  getCmsOrganization,
  getPublicOrganization,
  publishOrganization,
  saveOrganizationDraft
} from '../server/services/organization'
import { auditLogs, organizationConfigs } from '../server/db/schema'
import { DEFAULT_ORGANIZATION_STRUCTURE } from '../shared/types/organization'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

integration('组织架构草稿与发布链路', () => {
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'organization-auto-test-secret-at-least-32'
    await runMigrations()
  })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table organization_configs, audit_logs, sessions, user_roles, users restart identity cascade`)
    await getDatabase().insert(organizationConfigs).values({
      id: 'current',
      draftStructure: structuredClone(DEFAULT_ORGANIZATION_STRUCTURE),
      publishedStructure: structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    })
  })
  afterAll(closeDatabase)

  it('保存草稿不改变公开数据，明确发布后才切换公开版本', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'orgadmin', password: 'OrganizationAdmin123!' })
    const initial = await getCmsOrganization()
    const draft = structuredClone(initial.draft)
    draft.title = '调整后的当前架构'

    const saved = await saveOrganizationDraft(draft, initial.version, admin!.id)
    expect(saved.hasUnpublishedChanges).toBe(true)
    expect(saved.draft.title).toBe('调整后的当前架构')
    expect((await getPublicOrganization()).structure.title).toBe('当前组织架构')

    const published = await publishOrganization(saved.version, admin!.id)
    expect(published.hasUnpublishedChanges).toBe(false)
    expect((await getPublicOrganization()).structure.title).toBe('调整后的当前架构')
    expect(published.publishedVersion).toBe(saved.version)

    const actions = (await getDatabase().select().from(auditLogs)).map(row => row.action)
    expect(actions).toContain('organization.draft.save')
    expect(actions).toContain('organization.publish')
  })

  it('用版本号阻止两个管理员互相覆盖', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'orgconflict', password: 'OrganizationAdmin123!' })
    const initial = await getCmsOrganization()
    await saveOrganizationDraft({ ...initial.draft, title: '管理员 A' }, initial.version, admin!.id)
    await expect(saveOrganizationDraft(
      { ...initial.draft, title: '管理员 B' },
      initial.version,
      admin!.id
    )).rejects.toThrow('ORGANIZATION_VERSION_CONFLICT')
  })
})
