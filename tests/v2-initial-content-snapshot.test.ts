import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareInitialContentSnapshot } from '../server/services/initial-content-snapshot'
import { readContentRepositorySnapshot } from '../server/services/content-export-snapshot'
import { sha256ContentBytes } from '../server/services/content-export-serialization'

const roots: string[] = []
const remote = 'git@github.com:SDUTVINCI/sdutvinci_content.git'

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'vinci-initial-content-test-'))
  roots.push(root)
  await mkdir(join(root, 'content/news'), { recursive: true })
  await mkdir(join(root, 'content/wiki/guide'), { recursive: true })
  await mkdir(join(root, 'content/members/2026'), { recursive: true })
  await writeFile(join(root, 'content/news/hello.md'), `---
title: Hello
authors:
  - abc
---
News body.
`)
  await writeFile(join(root, 'content/wiki/guide/index.md'), `---
title: Guide
contributors:
  - abc
---
Wiki body.
`)
  await writeFile(join(root, 'content/members/2026/member.md'), `---
id: abc
name: Test Member
image: /images/test-member.webp
time: 2026
---
Member body.
`)
  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.name', 'Vinci Test')
  git(root, 'config', 'user.email', 'vinci-test@example.invalid')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'add', 'content')
  execFileSync('git', ['-C', root, 'commit', '-m', 'test baseline'], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-02T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-02T00:00:00Z'
    },
    stdio: 'ignore'
  })
  const commit = git(root, 'rev-parse', 'HEAD')
  git(root, 'update-ref', 'refs/remotes/origin/main', commit)
  return { root, commit }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('初始内容复制到受校验 V2 快照', () => {
  it('不修改来源，并确定性生成可恢复的文章、成员、snapshot 与 manifest', async () => {
    const source = await fixture()
    const parent = await mkdtemp(join(tmpdir(), 'vinci-initial-output-test-'))
    roots.push(parent)
    const first = join(parent, 'first')
    const second = join(parent, 'second')
    const firstReport = await prepareInitialContentSnapshot({
      sourceRoot: source.root,
      outputRoot: first,
      sourceCommit: source.commit,
      expectedRemote: remote
    })
    const secondReport = await prepareInitialContentSnapshot({
      sourceRoot: source.root,
      outputRoot: second,
      sourceCommit: source.commit,
      expectedRemote: remote
    })

    expect(firstReport).toMatchObject({ articleCount: 2, memberCount: 1 })
    expect(secondReport.snapshotSha256).toBe(firstReport.snapshotSha256)
    expect(secondReport.manifestSha256).toBe(firstReport.manifestSha256)
    expect(git(source.root, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('')
    const snapshot = await readContentRepositorySnapshot(first)
    expect(snapshot?.files).toHaveLength(2)
    expect(snapshot?.members).toHaveLength(1)
    expect(snapshot?.files.every(file => file.path.startsWith(`${file.collection}/`))).toBe(true)
    expect(await readFile(join(first, '.vinci/source-commit'), 'utf8')).toBe(`${source.commit}\n`)
    const snapshotSource = await readFile(join(first, '.vinci/snapshot.json'), 'utf8')
    const manifest = JSON.parse(await readFile(join(first, 'manifest.json'), 'utf8'))
    expect(manifest.snapshot.sha256).toBe(sha256ContentBytes(snapshotSource))
    expect(manifest.files).toHaveLength(3)
    expect(await readFile(join(first, 'news/hello.md'), 'utf8')).toContain('vinciId:')
  })

  it('拒绝脏来源、错误 Commit 和来源输出重叠', async () => {
    const source = await fixture()
    const parent = await mkdtemp(join(tmpdir(), 'vinci-initial-reject-test-'))
    roots.push(parent)
    await writeFile(join(source.root, 'untracked.txt'), 'unsafe')
    await expect(prepareInitialContentSnapshot({
      sourceRoot: source.root,
      outputRoot: join(parent, 'dirty'),
      sourceCommit: source.commit,
      expectedRemote: remote
    })).rejects.toThrow('INITIAL_CONTENT_SOURCE_DIRTY')
    await rm(join(source.root, 'untracked.txt'))
    await expect(prepareInitialContentSnapshot({
      sourceRoot: source.root,
      outputRoot: join(parent, 'wrong-commit'),
      sourceCommit: '0'.repeat(40),
      expectedRemote: remote
    })).rejects.toThrow('INITIAL_CONTENT_COMMIT_MISMATCH')
    await expect(prepareInitialContentSnapshot({
      sourceRoot: source.root,
      outputRoot: join(source.root, 'nested'),
      sourceCommit: source.commit,
      expectedRemote: remote
    })).rejects.toThrow('INITIAL_CONTENT_SOURCE_OUTPUT_OVERLAP')
  })
})
