import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSafeMemberPublicUrl,
  memberProfileFromMarkdown,
  mergeMemberProfiles,
  serializeMemberProfile
} from '../server/services/member-profile'

describe('V2 阶段 9 成员资料边界与确定性序列化', () => {
  it('完整解析 32 份既有成员资料且序列化结果确定', async () => {
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
    expect(files).toHaveLength(32)
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
  })

  it('拒绝账号、安全、权限与内网 URL 字段进入公开资料', () => {
    expect(() => memberProfileFromMarkdown('---\nid: memberone\nname: One\nmetadata:\n  account: admin\n---\n', 'one.md'))
      .toThrow(/MEMBER_SENSITIVE_FIELD_REJECTED/)
    expect(() => memberProfileFromMarkdown('---\nid: memberone\nname: One\nimage: http:\/\/127.0.0.1\/secret\n---\n', 'one.md'))
      .toThrow('MEMBER_AVATAR_URL_UNSAFE')
    expect(isSafeMemberPublicUrl('https://example.com/avatar.png')).toBe(true)
    expect(isSafeMemberPublicUrl('http://localhost/private')).toBe(false)
  })

  it('字段级三方合并保留并行安全修改并阻止同字段冲突', () => {
    const base = memberProfileFromMarkdown('---\nid: memberone\nname: One\nrole: Member\ngrade: 2024\n---\n', 'one.md')
    const current = { ...base, role: 'Captain' }
    const proposed = { ...base, grade: '2025' }
    expect(mergeMemberProfiles(base, current, proposed).merged).toMatchObject({ role: 'Captain', grade: '2025' })
    const conflict = mergeMemberProfiles(base, current, { ...base, role: 'Advisor' })
    expect(conflict.merged).toBeNull()
    expect(conflict.conflicts).toEqual(['role'])
  })
})
