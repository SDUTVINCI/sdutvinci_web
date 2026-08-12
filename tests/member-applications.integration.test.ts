import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import {
  listSubmittedMemberApplications,
  reviewMemberApplication,
  startMemberApplication,
  submitMemberApplication,
  uploadMemberApplicationAvatar
} from '../server/services/member-applications'
import { memberApplications, members } from '../server/db/schema'
import { uploadCmsMemberAvatar } from '../server/services/cms-member-avatar'
import { createCmsMember } from '../server/services/cms-members'
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
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#167d8b' }
    }).png().toBuffer()
    const uploaded = await uploadMemberApplicationAvatar({
      id: application.id,
      token: application.token,
      name: '测试成员',
      data: image,
      mimeType: 'image/png'
    })
    expect(uploaded.url).toContain('/member-applications/')
    await expect(submitMemberApplication(application.id, 'wrong-token', {})).rejects.toThrow('MEMBER_APPLICATION_NOT_FOUND')
    await submitMemberApplication(application.id, application.token, {
      name: '测试成员', grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['24', '25'],
      affiliation: '机械工程学院', advisorSeasons: [], body: '公开简介', links: { github: '', 'home-page': 'https://example.com/profile' }
    })
    expect(await getDatabase().select().from(members)).toHaveLength(0)
    const submitted = await listSubmittedMemberApplications()
    expect(submitted).toHaveLength(1)
    await getDatabase().update(memberApplications).set({
      profile: { ...(submitted[0]!.profile as Record<string, unknown>), links: { github: '', 'home-page': 'https://example.com/profile' } }
    }).where(eq(memberApplications.id, application.id))
    const result = await reviewMemberApplication(application.id, 'approve', '资料核对通过', admin!.id)
    expect(result.status).toBe('approved')
    const online = await getDatabase().select().from(members)
    expect(online).toHaveLength(1)
    expect(online[0]).toMatchObject({ memberKey: 'ceshichengyuan', name: '测试成员', groupName: '软件算法组', memberType: '软件算法组', positions: ['成员'], seasons: ['24', '25'], links: { 'home-page': 'https://example.com/profile' } })
    expect(decodeURIComponent(online[0]?.avatarUrl || '')).toContain('/site-assets/images/member_photo/测试成员-')
    const reviewed = (await getDatabase().select().from(memberApplications))[0]!
    expect(reviewed).toMatchObject({ status: 'approved', avatarPublicUrl: online[0]?.avatarUrl })
    expect(reviewed.avatarObjectKey).toMatch(/^site-assets\/images\/member_photo\/测试成员-[0-9a-f]{8}\.webp$/)
    const config = {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
      }
    }
    const client = new S3Client(config)
    await expect(client.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: reviewed.avatarObjectKey!
    }))).resolves.toBeTruthy()
    await expect(client.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: `member-applications/${new Date().getUTCFullYear()}/${uploaded.filename}`
    }))).rejects.toBeTruthy()
  })

  it('拒绝不存在或未提交申请，且服务端拒绝年度外组别', async () => {
    const application = await startMemberApplication()
    await expect(submitMemberApplication(application.id, application.token, {
      name: '错误组别', grade: '2025', groupName: '电路组', positions: ['成员']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
  })

  it('同名成员使用从 1 开始的最小可用数字后缀', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'keyadmin', password: 'KeyAdminPassword123!' })
    for (const expectedKey of ['tongmingchengyuan', 'tongmingchengyuan1', 'tongmingchengyuan2']) {
      const application = await startMemberApplication()
      await submitMemberApplication(application.id, application.token, {
        name: '同名成员', grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
      })
      const result = await reviewMemberApplication(application.id, 'approve', '', admin!.id)
      expect(result.member?.memberKey).toBe(expectedKey)
    }
  })

  it('CMS 编辑头像复用 WebP 哈希命名并直接生成成员 Revision', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'avataradmin', password: 'AvatarAdminPassword123!' })
    const member = await createCmsMember({
      memberKey: 'avatarmember',
      name: '头像成员',
      sourcePath: 'members/2025/头像成员.md',
      groupName: '软件算法组',
      positions: ['成员'],
      seasons: ['25'],
      grade: '2025'
    }, admin!.id)
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#21a5b5' }
    }).png().toBuffer()
    const result = await uploadCmsMemberAvatar({
      memberId: member!.id,
      expectedVersion: member!.version,
      data: image,
      mimeType: 'image/png',
      actorUserId: admin!.id
    })
    expect(result.filename).toMatch(/^头像成员-[0-9a-f]{8}\.webp$/)
    expect(result.url).toContain('/site-assets/images/member_photo/')
    expect(result.member).toMatchObject({ avatarUrl: result.url, version: 2 })
  })
})
