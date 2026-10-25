import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = resolve('scripts/sync-tcr-image.sh')
const commit = 'a'.repeat(40)
const manifest = '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}'
const digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`
const temporaryRoots: string[] = []

async function fixture(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vinci-tcr-sync-'))
  temporaryRoots.push(root)
  const log = join(root, 'commands.jsonl')
  const fakeSkopeo = join(root, 'skopeo')
  await writeFile(fakeSkopeo, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SYNC_TEST_LOG, JSON.stringify(['skopeo', ...args]) + '\\n');
if (args[0] === 'inspect') {
  const target = args.at(-1).includes('ccr.ccs.tencentyun.com');
  process.stdout.write(target && process.env.SYNC_TEST_MISMATCH === 'true' ? '{}' : process.env.SYNC_TEST_MANIFEST);
} else if (args[0] === 'copy') {
  const state = process.env.SYNC_TEST_STATE;
  const attempt = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) + 1 : 1;
  fs.writeFileSync(state, String(attempt));
  if (process.env.SYNC_TEST_HANG === 'true') {
    setTimeout(() => {}, 10000);
  } else if (attempt <= Number(process.env.SYNC_TEST_FAILURES || 0)) {
    console.error(process.env.SYNC_TEST_ERROR || 'connection reset by peer');
    process.exit(1);
  }
} else {
  process.exit(2);
}
`)
  const fakeSleep = join(root, 'sleep')
  await writeFile(fakeSleep, '#!/bin/sh\nprintf \'["sleep","%s"]\\n\' "$1" >> "$SYNC_TEST_LOG"\n')
  const fakeTimeout = join(root, 'timeout')
  await writeFile(fakeTimeout, `#!/bin/bash
set -eu
if [ "\${SYNC_TEST_FAST_TIMEOUT:-}" = true ]; then
  shift 3
  exec /usr/bin/timeout --signal=TERM --kill-after=0.1s 0.5s "$@"
fi
exec /usr/bin/timeout "$@"
`)
  await Promise.all([fakeSkopeo, fakeSleep, fakeTimeout].map(path => chmod(path, 0o755)))
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    GITHUB_REPOSITORY: 'SDUTVINCI/sdutvinci_web',
    SYNC_TEST_LOG: log,
    SYNC_TEST_STATE: join(root, 'attempts'),
    SYNC_TEST_MANIFEST: manifest,
    ...overrides
  }
  const commands = async (): Promise<string[][]> =>
    (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const run = async (image = 'runtime', expectedDigest = digest) => {
    try {
      const result = await execFileAsync('bash', [script, commit, image, expectedDigest], { env, timeout: 10_000 })
      return { code: 0, ...result }
    } catch (error: any) {
      return { code: error.code, stdout: String(error.stdout), stderr: String(error.stderr) }
    }
  }
  return { env, commands, run }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('GHCR 到腾讯云镜像同步', () => {
  it.each(['runtime', 'operations'])('按固定摘要同步 %s 并读取目标确认一致', async (image) => {
    const f = await fixture()
    expect((await f.run(image)).code).toBe(0)
    const calls = await f.commands()
    const suffix = image === 'runtime' ? '' : '-ops'
    expect(calls).toEqual([
      ['skopeo', 'inspect', '--raw', `docker://ghcr.io/sdutvinci/sdutvinci_web${suffix}:${commit}`],
      ['skopeo', 'copy', '--all', '--preserve-digests', '--retry-times', '0',
        `docker://ghcr.io/sdutvinci/sdutvinci_web${suffix}@${digest}`,
        `docker://ccr.ccs.tencentyun.com/sdutvinci/sdutvinci_web${suffix}:${commit}`],
      ['skopeo', 'inspect', '--raw', `docker://ccr.ccs.tencentyun.com/sdutvinci/sdutvinci_web${suffix}:${commit}`]
    ])
  })

  it('临时网络错误最多尝试三次，并保持第一次解析的源摘要', async () => {
    const f = await fixture({ SYNC_TEST_FAILURES: '2' })
    expect((await f.run()).code).toBe(0)
    const calls = await f.commands()
    expect(calls.filter(call => call[1] === 'copy')).toHaveLength(3)
    expect(calls.filter(call => call[1] === 'inspect' && call.at(-1)?.includes('ghcr.io'))).toHaveLength(1)
    expect(calls.filter(call => call[0] === 'sleep')).toEqual([['sleep', '30'], ['sleep', '60']])
  })

  it('连续失败不会进行第四次尝试', async () => {
    const f = await fixture({ SYNC_TEST_FAILURES: '10' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('已尝试 3 次')
    expect((await f.commands()).filter(call => call[1] === 'copy')).toHaveLength(3)
  })

  it.each(['unauthorized: authentication required', 'denied: requested access is denied', 'manifest unknown', 'invalid reference format'])(
    '确定性错误不重试：%s', async (message) => {
      const f = await fixture({ SYNC_TEST_FAILURES: '10', SYNC_TEST_ERROR: message })
      expect((await f.run()).code).toBe(1)
      const calls = await f.commands()
      expect(calls.filter(call => call[1] === 'copy')).toHaveLength(1)
      expect(calls.filter(call => call[0] === 'sleep')).toHaveLength(0)
    }
  )

  it('源摘要与构建输出不符时禁止上传', async () => {
    const f = await fixture()
    expect((await f.run('runtime', `sha256:${'b'.repeat(64)}`)).code).toBe(1)
    expect((await f.commands()).filter(call => call[1] === 'copy')).toHaveLength(0)
  })

  it('目标摘要不一致不能报告成功或继续重试', async () => {
    const f = await fixture({ SYNC_TEST_MISMATCH: 'true' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('destination digest mismatch')
    expect((await f.commands()).filter(call => call[1] === 'copy')).toHaveLength(1)
  })

  it('手工补传可以解析已发布的 SHA 标签并锁定摘要', async () => {
    const f = await fixture()
    expect((await f.run('runtime', '')).code).toBe(0)
    expect((await f.commands()).find(call => call[1] === 'copy')).toContain(`docker://ghcr.io/sdutvinci/sdutvinci_web@${digest}`)
  })

  it('挂起的传输被超时终止，并受三次尝试限制', async () => {
    const f = await fixture({ SYNC_TEST_HANG: 'true', SYNC_TEST_FAST_TIMEOUT: 'true' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('退出码 124')
    expect((await f.commands()).filter(call => call[1] === 'copy')).toHaveLength(3)
  })

  it('取消任务会停止传输，不开始下一次尝试', async () => {
    const f = await fixture({ SYNC_TEST_HANG: 'true' })
    const child = spawn('bash', [script, commit, 'runtime', digest], { env: f.env, detached: true, stdio: 'ignore' })
    const finished = new Promise<number | null>((resolveFinished, reject) => {
      child.once('error', reject)
      child.once('close', code => resolveFinished(code))
    })
    try {
      await expect.poll(async () => {
        try { return (await f.commands()).some(call => call[1] === 'copy') } catch { return false }
      }).toBe(true)
      process.kill(-child.pid!, 'SIGTERM')
      expect(await finished).toBe(143)
      expect((await f.commands()).filter(call => call[0] === 'sleep')).toHaveLength(0)
    } finally {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* Already exited. */ }
    }
  })
})
