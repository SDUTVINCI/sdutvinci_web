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
const isUpload = (call: string[]) => call[0] === 'regctl' && call[1] === 'image' && call[2] === 'copy'

async function fixture(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vinci-tcr-sync-'))
  temporaryRoots.push(root)
  const log = join(root, 'commands.jsonl')
  const fakeSkopeo = join(root, 'skopeo')
  await writeFile(fakeSkopeo, `#!/usr/bin/env node
const fs = require('node:fs');
const binary = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SYNC_TEST_LOG, JSON.stringify([binary, ...args]) + '\\n');
if (binary === 'regctl' && args[0] === 'registry' && args[1] === 'set') {
  process.exit(0);
} else if (args[0] === 'inspect') {
  const target = args.at(-1).includes('ccr.ccs.tencentyun.com');
  const cached = args.at(-1).startsWith('oci:');
  const mismatch = (target && process.env.SYNC_TEST_MISMATCH === 'true') || (cached && process.env.SYNC_TEST_CACHE_MISMATCH === 'true');
  process.stdout.write(mismatch ? '{}' : process.env.SYNC_TEST_MANIFEST);
} else if (args[0] === 'copy' || (binary === 'regctl' && args[0] === 'image' && args[1] === 'copy')) {
  const download = args.at(-1).startsWith('oci:');
  const stage = download ? 'download' : 'upload';
  const state = process.env.SYNC_TEST_STATE + '-' + stage;
  const attempt = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) + 1 : 1;
  fs.writeFileSync(state, String(attempt));
  if (stage === (process.env.SYNC_TEST_HANG_STAGE || 'upload') && process.env.SYNC_TEST_HANG === 'true') {
    setTimeout(() => {}, 10000);
  } else if (stage === (process.env.SYNC_TEST_FAILURE_STAGE || 'upload') && attempt <= Number(process.env.SYNC_TEST_FAILURES || 0)) {
    console.error(process.env.SYNC_TEST_ERROR || 'connection reset by peer');
    process.exit(1);
  } else if (download) {
    const directory = args.at(-1).slice(4).replace(/:release$/, '');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(directory + '/index.json', process.env.SYNC_TEST_MANIFEST);
  }
} else {
  process.exit(2);
}
`)
  const fakeRegctl = join(root, 'regctl')
  await writeFile(fakeRegctl, await readFile(fakeSkopeo))
  const fakeSleep = join(root, 'sleep')
  await writeFile(fakeSleep, '#!/bin/sh\nprintf \'["sleep","%s"]\\n\' "$1" >> "$SYNC_TEST_LOG"\n')
  const fakeTimeout = join(root, 'timeout')
  await writeFile(fakeTimeout, `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$SYNC_TEST_TIMEOUT_LOG"
if [ "\${SYNC_TEST_FAST_TIMEOUT:-}" = true ]; then
  shift 3
  exec /usr/bin/timeout --signal=TERM --kill-after=0.1s 1.5s "$@"
fi
exec /usr/bin/timeout "$@"
`)
  await Promise.all([fakeSkopeo, fakeRegctl, fakeSleep, fakeTimeout].map(path => chmod(path, 0o755)))
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    GITHUB_REPOSITORY: 'SDUTVINCI/sdutvinci_web',
    SYNC_TEST_LOG: log,
    SYNC_TEST_STATE: join(root, 'attempts'),
    SYNC_TEST_TIMEOUT_LOG: join(root, 'timeouts'),
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
    expect(calls).toHaveLength(6)
    expect(calls[0]).toEqual(['skopeo', 'inspect', '--raw', `docker://ghcr.io/sdutvinci/sdutvinci_web${suffix}:${commit}`])
    const cache = calls[1]!.at(-1)!
    expect(cache).toMatch(/^oci:.*\/image:release$/)
    expect(calls[1]).toEqual(['skopeo', 'copy', '--all', '--preserve-digests', '--retry-times', '0',
      `docker://ghcr.io/sdutvinci/sdutvinci_web${suffix}@${digest}`, cache])
    expect(calls[2]).toEqual(['skopeo', 'inspect', '--raw', cache])
    expect(calls[3]).toEqual(['regctl', 'registry', 'set', 'ccr.ccs.tencentyun.com', '--skip-check',
      '--blob-max', '8388608', '--blob-chunk', '8388608', '--req-concurrent', '2'])
    expect(calls[4]).toEqual(['regctl', 'image', 'copy', '--force-recursive', '--verbosity', 'info',
      cache.replace(/^oci:/, 'ocidir://'), `ccr.ccs.tencentyun.com/sdutvinci/sdutvinci_web${suffix}:${commit}`])
    expect(calls[5]).toEqual(['skopeo', 'inspect', '--raw', `docker://ccr.ccs.tencentyun.com/sdutvinci/sdutvinci_web${suffix}:${commit}`])
  })

  it('临时网络错误最多尝试三次，并保持第一次解析的源摘要', async () => {
    const f = await fixture({ SYNC_TEST_FAILURES: '2' })
    expect((await f.run()).code).toBe(0)
    const calls = await f.commands()
    expect(calls.filter(call => call[1] === 'copy' && call.at(-1)?.startsWith('oci:'))).toHaveLength(1)
    expect(calls.filter(isUpload)).toHaveLength(3)
    expect(calls.filter(call => call[1] === 'inspect' && call.at(-1)?.includes('ghcr.io'))).toHaveLength(1)
    expect(calls.filter(call => call[0] === 'sleep')).toEqual([['sleep', '30'], ['sleep', '60']])
    const timeouts = (await readFile(f.env.SYNC_TEST_TIMEOUT_LOG, 'utf8')).trim().split('\n')
    expect(timeouts).toHaveLength(3)
    expect(timeouts.every(call => call === '--signal=TERM --kill-after=10s 3600s bash -c sync_attempt')).toBe(true)
  })

  it('连续失败不会进行第四次尝试', async () => {
    const f = await fixture({ SYNC_TEST_FAILURES: '10' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('已尝试 3 次')
    expect((await f.commands()).filter(isUpload)).toHaveLength(3)
  })

  it.each(['unauthorized: authentication required', 'denied: requested access is denied', 'manifest unknown', 'invalid reference format'])(
    '确定性错误不重试：%s', async (message) => {
      const f = await fixture({ SYNC_TEST_FAILURES: '10', SYNC_TEST_ERROR: message })
      expect((await f.run()).code).toBe(1)
      const calls = await f.commands()
      expect(calls.filter(isUpload)).toHaveLength(1)
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
    expect((await f.commands()).filter(isUpload)).toHaveLength(1)
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
    expect(result.stderr).toContain('阶段：本地缓存上传腾讯云')
    const calls = await f.commands()
    expect(calls.filter(isUpload)).toHaveLength(3)
    expect(calls.filter(call => call[1] === 'copy' && call.at(-1)?.startsWith('oci:'))).toHaveLength(1)
  })

  it('下载失败时不上传，重试完成下载后才上传', async () => {
    const f = await fixture({ SYNC_TEST_FAILURES: '1', SYNC_TEST_FAILURE_STAGE: 'download' })
    const result = await f.run()
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('阶段：GHCR 下载到本地')
    const copies = (await f.commands()).filter(call => call[1] === 'copy' || isUpload(call))
    expect(copies.map(call => call.at(-1)?.startsWith('oci:'))).toEqual([true, true, false])
  })

  it('本地缓存摘要不一致时禁止上传', async () => {
    const f = await fixture({ SYNC_TEST_CACHE_MISMATCH: 'true' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('cache digest mismatch')
    expect((await f.commands()).filter(isUpload)).toHaveLength(0)
  })

  it('下载挂起时明确报告下载阶段，且不会开始上传', async () => {
    const f = await fixture({ SYNC_TEST_HANG: 'true', SYNC_TEST_HANG_STAGE: 'download', SYNC_TEST_FAST_TIMEOUT: 'true' })
    const result = await f.run()
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('阶段：GHCR 下载到本地')
    expect((await f.commands()).filter(isUpload)).toHaveLength(0)
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
        try { return (await f.commands()).some(isUpload) } catch { return false }
      }).toBe(true)
      process.kill(-child.pid!, 'SIGTERM')
      expect(await finished).toBe(143)
      expect((await f.commands()).filter(call => call[0] === 'sleep')).toHaveLength(0)
    } finally {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* Already exited. */ }
    }
  })
})
