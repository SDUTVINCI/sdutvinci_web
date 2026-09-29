import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSafeMemberPublicUrl,
  isSafeMemberAvatarUrl,
  memberProfileFromMarkdown,
  memberFieldDiff,
  mergeMemberProfiles,
  serializeMemberProfile
} from '../server/services/member-profile'
import { parseCmsMarkdown } from '../server/utils/cms-frontmatter'

describe('V2 阶段 9 成员资料边界与确定性序列化', () => {
  it('将旧指导老师届次正确归入指导记录，并给所有成员输出同一套 frontmatter 字段', () => {
    const teacher = memberProfileFromMarkdown('---\nid: teachertest\nname: Teacher\nrole: 指导老师，教授\ntype: 指导老师\ntime: 16,17,18\ngrade: null\n---\n简介\n', 'teacher/test.md')
    const student = memberProfileFromMarkdown('---\nid: studenttest\nname: Student\nrole: 机械组成员\ntype: 机械组\ntime: 18\nadvisor: 17,18\ngrade: 2016\n---\n', '2018/test.md')
    expect(teacher.seasons).toEqual([])
    expect(teacher.advisorSeasons).toEqual(['16', '17', '18'])
    const teacherSource = serializeMemberProfile(teacher).source
    const studentSource = serializeMemberProfile(student).source
    expect(Object.keys(parseCmsMarkdown(teacherSource).frontmatter)).toEqual(Object.keys(parseCmsMarkdown(studentSource).frontmatter))
    expect(memberProfileFromMarkdown(teacherSource, 'teacher/test.md')).toMatchObject({
      positions: ['指导老师'], seasons: [], advisorSeasons: ['16', '17', '18'], role: '指导老师，教授'
    })
    expect(memberProfileFromMarkdown(studentSource, '2018/test.md')).toMatchObject({
      positions: ['成员'], seasons: ['18'], advisorSeasons: ['17', '18']
    })
  })
  it('完整解析全部既有成员资料且序列化结果确定', async () => {
    const snapshotSource = process.env.V2_CONTENT_SNAPSHOT_SOURCE
    expect(snapshotSource, 'V2_CONTENT_SNAPSHOT_SOURCE 必须指向独立内容仓库快照')
      .toBeTruthy()
    const root = resolve(snapshotSource!, 'members')
    const walk = async (directory: string, prefix = ''): Promise<string[]> => {
      const result: string[] = []
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) result.push(...await walk(join(directory, entry.name), relative))
        else if (entry.isFile() && entry.name.endsWith('.md')) result.push(relative)
      }
      return result
    }
    const files = (await walk(root)).sort()
    expect(files.length).toBeGreaterThanOrEqual(32)
    const keys = new Set<string>()
    for (const [sortOrder, file] of files.entries()) {
      const source = await readFile(join(root, file), 'utf8')
      const profile = memberProfileFromMarkdown(source, file, { allowLegacyUnknownFields: true, sortOrder })
      expect(keys.has(profile.memberKey)).toBe(false)
      keys.add(profile.memberKey)
      const first = serializeMemberProfile(profile)
      const second = serializeMemberProfile(profile)
      expect(second).toEqual(first)
      expect(first.path).toBe(`members/${file}`)
      expect(first.source.endsWith('\n')).toBe(true)
    }
    expect(keys.size).toBe(files.length)
  })

  it('拒绝账号、安全、权限与内网 URL 字段进入公开资料', () => {
    expect(() => memberProfileFromMarkdown('---\nid: memberone\nname: One\nmetadata:\n  account: admin\n---\n', 'one.md'))
      .toThrow(/MEMBER_SENSITIVE_FIELD_REJECTED/)
    expect(() => memberProfileFromMarkdown('---\nid: memberone\nname: One\nimage: http:\/\/127.0.0.1\/secret\n---\n', 'one.md'))
      .toThrow('MEMBER_AVATAR_URL_UNSAFE')
    expect(isSafeMemberPublicUrl('https://example.com/avatar.png')).toBe(true)
    expect(isSafeMemberPublicUrl('http://localhost/private')).toBe(false)
  })

  it('头像只额外允许当前配置的 S3 公共前缀', () => {
    const previous = process.env.S3_PUBLIC_BASE_URL
    process.env.S3_PUBLIC_BASE_URL = 'http://127.0.0.1:5901/vinci-local-test'
    try {
      expect(isSafeMemberAvatarUrl('http://127.0.0.1:5901/vinci-local-test/member-applications/2026/a.webp')).toBe(true)
      expect(isSafeMemberAvatarUrl('http://127.0.0.1:5901/other/private.webp')).toBe(false)
      expect(isSafeMemberAvatarUrl('http://127.0.0.1:9999/vinci-local-test/private.webp')).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.S3_PUBLIC_BASE_URL
      else process.env.S3_PUBLIC_BASE_URL = previous
    }
  })

  it('字段级三方合并保留并行安全修改并阻止同字段冲突', () => {
    const base = memberProfileFromMarkdown('---\nid: memberone\nname: One\nrole: Member\ngrade: 2024\n---\n', 'one.md')
    const current = { ...base, role: 'Captain' }
    const proposed = { ...base, grade: '2025' }
    expect(mergeMemberProfiles(base, current, proposed).merged).toMatchObject({ role: 'Captain', grade: '2025' })
    const conflict = mergeMemberProfiles(base, current, { ...base, role: 'Advisor' })
    expect(conflict.merged).toBeNull()
    expect(conflict.conflicts).toEqual(['role'])
    const groupChange = { ...base, groupName: '机械组', positions: ['组长'] }
    expect(memberFieldDiff(base, groupChange)).toMatchObject({
      group: { to: '机械组' }, positions: { to: ['组长'] }
    })
  })
})
