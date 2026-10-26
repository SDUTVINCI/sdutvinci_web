import { saveMemberCohort } from '../server/services/member-options'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
import { createCmsMember, deleteCmsMember, submitCmsMemberProfile, applyMemberProposal, getCmsMember } from '../server/services/cms-members'
import { promoteMemberApplicationAvatar } from '../server/services/member-avatar-storage'
import { resetCmsMediaConfigForTests } from '../server/utils/cms-media-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

integration('公开成员申请审核', () => {
  const objects = new Map<string, Buffer>()
  let restoreStorage: () => void
  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'member-application-auto-test-secret-32'
    for (const [key, value] of Object.entries({
      S3_ENDPOINT: 'https://s3.member-test.example', S3_REGION: 'test-1', S3_BUCKET: 'member-test',
      S3_ACCESS_KEY_ID: 'test-key', S3_SECRET_ACCESS_KEY: 'test-secret',
      S3_PUBLIC_BASE_URL: 'https://images.member-test.example', S3_FORCE_PATH_STYLE: 'true'
    })) vi.stubEnv(key, value)
    resetCmsMediaConfigForTests()
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command) => {
      if (command instanceof PutObjectCommand) objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer))
      else if (command instanceof CopyObjectCommand) {
        const source = decodeURIComponent(command.input.CopySource!).slice('member-test/'.length)
        const body = objects.get(source)
        if (!body) throw new Error('NoSuchKey')
        objects.set(command.input.Key!, Buffer.from(body))
      } else if (command instanceof DeleteObjectCommand) objects.delete(command.input.Key!)
      else if (command instanceof HeadObjectCommand) {
        if (!objects.has(command.input.Key!)) throw new Error('NotFound')
      } else throw new Error('Unexpected S3 operation')
      return { $metadata: { httpStatusCode: 200 } } as never
    })
    restoreStorage = () => send.mockRestore()
    await runMigrations()
  })
  beforeEach(async () => {
    objects.clear()
    await getDatabase().execute(sql`truncate table member_applications, content_export_jobs, audit_logs, sessions, user_members, user_roles, member_revisions, members, users restart identity cascade`)
  })
  afterAll(async () => {
    restoreStorage?.()
    vi.unstubAllEnvs()
    resetCmsMediaConfigForTests()
    await closeDatabase()
  })

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
    expect(decodeURIComponent(online[0]?.avatarUrl || '')).toContain(`/site-assets/images/member_photo/${application.id}/`)
    const reviewed = (await getDatabase().select().from(memberApplications))[0]!
    expect(reviewed).toMatchObject({ status: 'approved', avatarPublicUrl: online[0]?.avatarUrl })
    expect(reviewed.avatarObjectKey).toMatch(new RegExp(`^site-assets/images/member_photo/${application.id}/[0-9a-f-]{36}/测试成员-[0-9a-f]{8}\\.webp$`))
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
      Key: `member-applications/${new Date().getUTCFullYear()}/${application.id}/${uploaded.filename}`
    }))).rejects.toBeTruthy()
  })

  it('2026级新学员完整申请允许空职务和空赛季，审核后保留学员分类', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'learnerreview', password: 'ReviewAdminPassword123!' })
    await saveMemberCohort({ gradeYear: 2026, season: '28', seasonEnabled: false, active: true, groups: ['机械组'] })
    const application = await startMemberApplication()
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#16878b' } }).png().toBuffer()
    await uploadMemberApplicationAvatar({ id: application.id, token: application.token, name: '新学员', data: image, mimeType: 'image/png' })
    await submitMemberApplication(application.id, application.token, { isLearner: true, name: '新学员', grade: '2026', groupName: '机械组', positions: [], seasons: [], advisorSeasons: [], links: {} })
    expect(await getDatabase().select().from(members)).toHaveLength(0)
    const result = await reviewMemberApplication(application.id, 'approve', '', admin!.id)
    expect(result.member).toMatchObject({ isLearner: true, grade: '2026', groupName: '机械组', positions: [], seasons: [], memberType: '学员' })
  })

  it('拒绝不存在或未提交申请，且服务端拒绝年度外组别', async () => {
    const application = await startMemberApplication()
    await expect(submitMemberApplication(application.id, application.token, {
      name: '缺少头像', grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ad3232' }
    }).png().toBuffer()
    await uploadMemberApplicationAvatar({
      id: application.id,
      token: application.token,
      name: '错误组别',
      data: image,
      mimeType: 'image/png'
    })
    await expect(submitMemberApplication(application.id, application.token, {
      name: '错误组别', grade: '2025', groupName: '电路组', positions: ['成员'], seasons: ['25']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
  })

  it('指导老师必须选择参加赛季且不能填写学生或顾问字段', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'teacheradmin', password: 'TeacherAdminPassword123!' })
    const application = await startMemberApplication()
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#208090' }
    }).png().toBuffer()
    await uploadMemberApplicationAvatar({
      id: application.id,
      token: application.token,
      name: '测试指导老师',
      data: image,
      mimeType: 'image/png'
    })
    await expect(submitMemberApplication(application.id, application.token, {
      name: '测试指导老师', positions: ['成员'], seasons: [], advisorSeasons: ['27']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
    await expect(submitMemberApplication(application.id, application.token, {
      name: '测试指导老师', positions: ['指导老师'], seasons: [], advisorSeasons: ['27']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
    await expect(submitMemberApplication(application.id, application.token, {
      name: '测试指导老师', positions: ['指导老师'], seasons: ['27'], advisorSeasons: ['27']
    })).rejects.toThrow('MEMBER_APPLICATION_PROFILE_INVALID')
    await submitMemberApplication(application.id, application.token, {
      name: '测试指导老师', positions: ['指导老师'], seasons: ['27'], advisorSeasons: []
    })
    const submitted = (await listSubmittedMemberApplications())[0]!
    expect(submitted.profile).toMatchObject({ grade: null, seasons: ['27'], advisorSeasons: [] })
    const result = await reviewMemberApplication(application.id, 'approve', '', admin!.id)
    expect(result.member).toMatchObject({
      grade: null,
      memberType: '指导老师',
      seasons: ['27'],
      advisorSeasons: []
    })
  })

  it('普通学生的顾问身份跟随顾问届次', async () => {
    const application = await startMemberApplication()
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#208090' } }).png().toBuffer()
    await uploadMemberApplicationAvatar({ id: application.id, token: application.token,
      name: '测试顾问', data: image, mimeType: 'image/png' })
    await submitMemberApplication(application.id, application.token, {
      name: '测试顾问', grade: '2025', positions: ['成员'], seasons: ['26'], advisorSeasons: ['27']
    })
    expect((await listSubmittedMemberApplications())[0]!.profile).toMatchObject({
      positions: ['成员', '顾问'], seasons: ['26'], advisorSeasons: ['27']
    })
  })

  it('同名成员使用从 1 开始的最小可用数字后缀', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'keyadmin', password: 'KeyAdminPassword123!' })
    const created: Array<{ id: string, version: number }> = []
    for (const [index, expectedKey] of ['tongmingchengyuan', 'tongmingchengyuan1', 'tongmingchengyuan2'].entries()) {
      const application = await startMemberApplication()
      const image = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 22 + index, g: 125, b: 139 } }
      }).png().toBuffer()
      await uploadMemberApplicationAvatar({
        id: application.id,
        token: application.token,
        name: '同名成员',
        data: image,
        mimeType: 'image/png'
      })
      await submitMemberApplication(application.id, application.token, {
        name: '同名成员', grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
      })
      const result = await reviewMemberApplication(application.id, 'approve', '', admin!.id)
      expect(result.member?.memberKey).toBe(expectedKey)
      created.push({ id: result.member!.id, version: result.member!.version })
    }
    await deleteCmsMember(created[0]!.id, created[0]!.version, admin!.id)
    await deleteCmsMember(created[1]!.id, created[1]!.version, admin!.id)
    const application = await startMemberApplication()
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#208090' } }).png().toBuffer()
    await uploadMemberApplicationAvatar({ id: application.id, token: application.token, name: '同名成员', data: image, mimeType: 'image/png' })
    await submitMemberApplication(application.id, application.token, {
      name: '同名成员', grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
    })
    expect((await reviewMemberApplication(application.id, 'approve', '', admin!.id)).member?.memberKey)
      .toBe('tongmingchengyuan')
  })

  const submittedApplication = async (name = '重复申请') => {
    const application = await startMemberApplication()
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#208090' } }).png().toBuffer()
    const uploaded = await uploadMemberApplicationAvatar({ id: application.id, token: application.token, name, data: image, mimeType: 'image/png' })
    await submitMemberApplication(application.id, application.token, {
      name, grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
    })
    const [row] = await getDatabase().select().from(memberApplications).where(eq(memberApplications.id, application.id))
    return { ...application, uploaded, row: row! }
  }

  it('相同姓名和照片的申请互不覆盖，重复或并发审核只创建一份档案', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'repeatadmin', password: 'ReviewAdminPassword123!' })
    const first = await submittedApplication()
    const second = await submittedApplication()
    expect(first.uploaded.filename).toBe(second.uploaded.filename)
    expect(first.row.avatarObjectKey).not.toBe(second.row.avatarObjectKey)
    const [approved, repeated] = await Promise.all([
      reviewMemberApplication(first.id, 'approve', '', admin!.id),
      reviewMemberApplication(first.id, 'approve', '', admin!.id)
    ])
    expect(repeated.member!.id).toBe(approved.member!.id)
    expect(await getDatabase().select().from(members)).toHaveLength(1)
    expect((await getDatabase().execute(sql`select count(*)::int as count from member_revisions`)).rows[0]).toEqual({ count: 1 })
    expect((await getDatabase().execute(sql`select count(*)::int as count from content_export_jobs`)).rows[0]).toEqual({ count: 1 })
    await reviewMemberApplication(second.id, 'approve', '', admin!.id)
    await deleteCmsMember(approved.member!.id, approved.member!.version, admin!.id)
    const third = await submittedApplication()
    await reviewMemberApplication(third.id, 'approve', '', admin!.id)
    const applications = await getDatabase().select().from(memberApplications)
    expect(new Set(applications.map(item => item.avatarObjectKey)).size).toBe(3)
    for (const application of applications) expect(objects.has(application.avatarObjectKey!)).toBe(true)
    await expect(reviewMemberApplication(first.id, 'approve', '', admin!.id)).rejects.toThrow('MEMBER_APPLICATION_MEMBER_DELETED')
    expect(await getCmsMember(approved.member!.id)).toMatchObject({ deletedAt: expect.any(String) })
  })

  it('兼容旧临时头像，保留半成功审核遗留的已删除档案并允许重试', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'recoveryadmin', password: 'ReviewAdminPassword123!' })
    const application = await submittedApplication('历史申请')
    const legacyKey = `member-applications/${new Date().getUTCFullYear()}/${application.uploaded.filename}`
    objects.set(legacyKey, objects.get(application.row.avatarObjectKey!)!)
    objects.delete(application.row.avatarObjectKey!)
    await getDatabase().update(memberApplications).set({ avatarObjectKey: legacyKey }).where(eq(memberApplications.id, application.id))
    const legacy = await createCmsMember({
      memberKey: 'lishishenqing', name: '历史申请', sourcePath: `applications/${application.id}.md`,
      grade: '2025', groupName: '软件算法组', positions: ['成员'], seasons: ['25']
    }, admin!.id)
    await expect(reviewMemberApplication(application.id, 'approve', '', admin!.id)).rejects.toThrow('该申请已有成员档案')
    expect(objects.has(legacyKey)).toBe(true)
    await deleteCmsMember(legacy!.id, legacy!.version, admin!.id)
    const result = await reviewMemberApplication(application.id, 'approve', '', admin!.id)
    expect(result.member!.id).not.toBe(legacy!.id)
    expect(result.member!.sourcePath).toMatch(new RegExp(`^applications/${application.id}-[0-9a-f-]{36}\\.md$`))
    expect(await getCmsMember(legacy!.id)).toMatchObject({ sourcePath: legacy!.sourcePath, deletedAt: expect.any(String) })
    expect(objects.has(legacyKey)).toBe(false)
  })

  it('审核写入失败会回滚成员、Revision 和导出任务，保留原申请与头像供重试', async () => {
    const admin = await bootstrapCmsAdmin({ account: 'atomicadmin', password: 'ReviewAdminPassword123!' })
    const application = await submittedApplication('事务回滚')
    await getDatabase().execute(sql`
      create function vinci_test_fail_member_approval() returns trigger language plpgsql as $$
      begin
        if NEW.status = 'approved' then raise exception 'TEST_APPROVAL_FAILURE'; end if;
        return NEW;
      end $$;
      create trigger vinci_test_fail_member_approval before update on member_applications
        for each row execute function vinci_test_fail_member_approval();
    `)
    try {
      await expect(reviewMemberApplication(application.id, 'approve', '', admin!.id)).rejects.toThrow()
      expect(await getDatabase().select().from(members)).toHaveLength(0)
      for (const table of ['member_revisions', 'content_export_jobs']) {
        expect((await getDatabase().execute(sql.raw(`select count(*)::int as count from ${table}`))).rows[0]).toEqual({ count: 0 })
      }
      expect((await getDatabase().execute(sql`select count(*)::int as count from audit_logs where action = 'member.create'`)).rows[0]).toEqual({ count: 0 })
      const [pending] = await getDatabase().select().from(memberApplications).where(eq(memberApplications.id, application.id))
      expect(pending).toMatchObject({ status: 'submitted', approvedMemberId: null, avatarObjectKey: application.row.avatarObjectKey })
      expect([...objects.keys()]).toEqual([application.row.avatarObjectKey])
    } finally {
      await getDatabase().execute(sql`drop trigger vinci_test_fail_member_approval on member_applications; drop function vinci_test_fail_member_approval()`)
    }
    expect((await reviewMemberApplication(application.id, 'approve', '', admin!.id)).status).toBe('approved')
    expect(await getDatabase().select().from(members)).toHaveLength(1)
  })

  it('拒绝使用其他申请的头像，不会复制或删除原图', async () => {
    const first = await submittedApplication('头像归属')
    const second = await startMemberApplication()
    await expect(promoteMemberApplicationAvatar({ sourceKey: first.row.avatarObjectKey!, applicationId: second.id }))
      .rejects.toThrow('MEMBER_APPLICATION_AVATAR_KEY_INVALID')
    expect([...objects.keys()]).toEqual([first.row.avatarObjectKey])
  })

  it('CMS 编辑头像只准备候选图片，提交并审核后才生成成员 Revision', async () => {
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
    expect(await getCmsMember(member!.id)).toMatchObject({ avatarUrl: null, version: 1 })
    const proposal = await submitCmsMemberProfile(member!.id, { name: member!.name, avatarUrl: result.url, expectedVersion: 1 }, admin!.id)
    await applyMemberProposal(proposal.id, 1, 'APPLY_MEMBER_PROPOSAL', admin!.id)
    expect(await getCmsMember(member!.id)).toMatchObject({ avatarUrl: result.url, version: 2 })
  })
})
