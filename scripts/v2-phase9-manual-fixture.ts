import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import { applyCmsMemberMarkdownMigration, updateCmsMember } from '../server/services/cms-members'
import { loadDatabaseContentExportSnapshot } from '../server/services/content-export-snapshot'
import { memberProfileFromMarkdown, serializeMemberProfile } from '../server/services/member-profile'

const exec = promisify(execFile)
const stateRoot = process.env.PHASE9_MANUAL_STATE_ROOT || ''
const databaseUrl = new URL(process.env.DATABASE_URL || '')
if (!stateRoot.endsWith('/vinci-v2-phase9-manual-test')
  || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
  || !databaseUrl.pathname.includes('phase9_manual_test')) {
  throw new Error('PHASE9_MANUAL_ISOLATION_REQUIRED')
}
const workspace = join(stateRoot, 'content-workspace')
const remote = join(stateRoot, 'content-remote.git')
const write = async (root: string, path: string, source: string) => {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, source, 'utf8')
}

try {
  await runMigrations()
  await applyCmsMemberMarkdownMigration()
  const admin = await bootstrapCmsAdmin({ account: 'phase9admin', password: 'Phase9Manual123!' })
  const base = await loadDatabaseContentExportSnapshot()
  const byKey = new Map(base.activeMemberItems.map(item => [item.memberKey, item]))
  const required = ['dongjiahui', 'zouchangdi', 'caoqishuo', 'chenhourui', 'likun']
  if (required.some(key => !byKey.has(key))) throw new Error('PHASE9_MANUAL_MEMBERS_MISSING')

  await updateCmsMember(byKey.get('zouchangdi')!.memberId, {
    name: '邹昌迪', role: '数据库并行职责修改', expectedVersion: 1
  }, admin!.id)
  await updateCmsMember(byKey.get('caoqishuo')!.memberId, {
    name: '曹启硕', role: '数据库 Current 同字段修改', expectedVersion: 1
  }, admin!.id)

  await rm(workspace, { recursive: true, force: true })
  await rm(remote, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: workspace })
  await exec('git', ['config', 'user.name', 'Vinci Phase 9 Fixture'], { cwd: workspace })
  await exec('git', ['config', 'user.email', 'phase9-fixture@example.invalid'], { cwd: workspace })
  for (const item of base.activeMemberItems) await write(workspace, item.serialized.path, item.serialized.source)
  await write(workspace, '.vinci/snapshot.json', base.metadata.snapshotSource)
  await write(workspace, 'manifest.json', base.metadata.manifestSource)
  await write(workspace, 'README.md', '# Vinci Phase 9 isolated member PR fixture\n')
  await exec('git', ['add', '.'], { cwd: workspace })
  await exec('git', ['commit', '-m', 'test: phase 9 member base snapshot'], { cwd: workspace })
  const baseCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim()
  await exec('git', ['init', '--bare', remote])
  await exec('git', [`--git-dir=${remote}`, 'config', 'vinci.scope', 'v2-phase9-manual-test'])
  await exec('git', ['remote', 'add', 'origin', remote], { cwd: workspace })
  await exec('git', ['push', 'origin', 'main'], { cwd: workspace })
  await exec('git', ['switch', '-c', 'proposal/phase9-members'], { cwd: workspace })

  const proposed = (key: string, mutate: (profile: ReturnType<typeof memberProfileFromMarkdown>) => void) => {
    const item = byKey.get(key)!
    const profile = memberProfileFromMarkdown(item.serialized.source, item.sourcePath)
    mutate(profile)
    return serializeMemberProfile(profile).source
  }
  const safePath = byKey.get('dongjiahui')!.serialized.path
  const autoPath = byKey.get('zouchangdi')!.serialized.path
  const conflictPath = byKey.get('caoqishuo')!.serialized.path
  const sensitivePath = byKey.get('chenhourui')!.serialized.path
  const deletePath = byKey.get('likun')!.serialized.path
  await write(workspace, safePath, proposed('dongjiahui', profile => { profile.name = '董佳辉（PR 普通展示字段提案）' }))
  await write(workspace, autoPath, proposed('zouchangdi', profile => { profile.grade = 'PR 修改了不同安全字段' }))
  await write(workspace, conflictPath, proposed('caoqishuo', profile => { profile.role = 'PR Proposed 同字段修改' }))
  await write(workspace, sensitivePath, byKey.get('chenhourui')!.serialized.source.replace(
    /\n---\n/, '\nmetadata:\n  account: forbidden-login-id\n  permissions:\n    - admin\n---\n'
  ))
  await rm(join(workspace, deletePath))
  await exec('git', ['add', '-A'], { cwd: workspace })
  await exec('git', ['commit', '-m', 'test: phase 9 member proposals'], { cwd: workspace })
  const headCommit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim()
  await exec('git', ['push', 'origin', 'HEAD:refs/heads/proposal/phase9-members'], { cwd: workspace })

  const files = [
    { filename: safePath, status: 'modified', changes: 2 },
    { filename: autoPath, status: 'modified', changes: 2 },
    { filename: conflictPath, status: 'modified', changes: 2 },
    { filename: sensitivePath, status: 'modified', changes: 4 },
    { filename: deletePath, status: 'removed', changes: 2 }
  ]
  const contents: Record<string, string> = {}
  for (const [commit, paths] of [
    [baseCommit, ['.vinci/snapshot.json', ...files.map(file => file.filename)]],
    [headCommit, [safePath, autoPath, conflictPath, sensitivePath]]
  ] as const) {
    for (const path of paths) {
      contents[`${commit}:${path}`] = (await exec('git', [`--git-dir=${remote}`, 'show', `${commit}:${path}`])).stdout
    }
  }
  await writeFile(join(stateRoot, 'fixture.json'), `${JSON.stringify({
    repositoryId: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 9,
    baseCommit, headCommit, files, contents,
    expected: { safeKey: 'dongjiahui', autoMergeKey: 'zouchangdi', conflictKey: 'caoqishuo', sensitiveKey: 'chenhourui', deletionKey: 'likun' }
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(stateRoot, 'pull-state.json'), '{"state":"open"}\n', 'utf8')
  await writeFile(join(stateRoot, 'external-actions.jsonl'), '', 'utf8')
  process.stdout.write('阶段 9 fixture：32 名成员；PR #9 含安全、字段自动合并、同字段冲突、敏感拒绝和删除提案。\n')
} finally {
  await closeDatabase()
}
