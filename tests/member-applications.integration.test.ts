import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import {
  listSubmittedMemberApplications,
  reviewMemberApplication,
  startMemberApplication,
  submitMemberApplication
} from '../server/services/member-applications'
import { memberApplications, members } from '../server/db/schema'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

integration('公开成员申请审核', () => {
  beforeAll(async () => { process.env.CMS_AUTH_SECRET ??= 'member-application-auto-test-secret-32'; await runMigrations() })
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table member_applications, content_export_jobs, audit_logs, sessions, user_members, user_roles, member_revisions, members, users restart identity cascade`)
  })
  afterAll(closeDatabase)

  it('匿名提交不会上线，管理员明确通过后才创建正式成员和 Revision', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'reviewadmin', password: 'ReviewAdminPassword123!' })
    const application = await startMemberApplication()
    await expect(submitMemberApplication(application.id, 'wrong-token', {})).rejects.toThrow('MEMBER_APPLICATION_NOT_FOUND')
    await submitMemberApplication(application.id, application.token, {
      name: '测试成员', grade: '2025', groupName: '软件算法组', positions: ['成员'],
      affiliation: '机械工程学院', advisorSeasons: [], body: '公开简介', links: { homepage: 'https://example.com/profile' }
    })
    expect(await getDatabase().select().from(members)).toHaveLength(0)
    const submitted = await listSubmittedMemberApplications()
    expect(submitted).toHaveLength(1)
    const result = await reviewMemberApplication(application.id, 'approve', '资料核对通过', admin!.id)
    expect(result.status).toBe('approved')
    const online = await getDatabase().select().from(members)
    expect(online).toHaveLength(1)
    expect(online[0]).toMatchObject({ name: '测试成员', groupName: '软件算法组', memberType: '软件算法组', positions: ['成员'] })
    expect((await getDatabase().select().from(memberApplications))[0]?.status).toBe('approved')
  })

  it('拒绝不存在或未提交申请，且服务端拒绝年度外组别', async () => {
    const application = await startMemberApplication()
    await expect(submitMemberApplication(application.id, application.token, {
      name: '错误组别', grade: '2025', groupName: '电路组', positions: ['成员']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
  })
})
