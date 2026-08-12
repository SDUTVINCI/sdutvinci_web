import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 一键本地测试环境', () => {
  it('固定隔离资源、完整夹具、测试管理员和安全清理边界', async () => {
    const [shell, fixture, entrypoint, guide] = await Promise.all([
      readFile('scripts/cms-local-test.sh', 'utf8'),
      readFile('scripts/cms-local-test-fixture.ts', 'utf8'),
      readFile('docker/entrypoint.sh', 'utf8'),
      readFile('docs/CMS_LOCAL_TEST_ENVIRONMENT.md', 'utf8')
    ])

    expect(shell).toContain('vinci-cms-local-test-postgres')
    expect(shell).toContain('vinci-cms-local-test-app')
    expect(shell).toContain('vinci_cms_local_test')
    expect(shell).toContain('127.0.0.1:${database_port}:5432')
    expect(shell).toContain('127.0.0.1 --port "$app_port"')
    expect(shell).toContain('container_is_owned "$container_name"')
    expect(shell).toContain('runtime_image="vinci-cms-local-test-runtime:test"')
    expect(shell).toContain('docker image inspect "$runtime_image"')
    expect(shell).toContain('s3_container_name="vinci-cms-local-test-s3"')
    expect(shell).toContain('-d "$runtime_image"')
    expect(shell).toContain('find "$state_root" -xdev -depth -mindepth 1 -delete')
    expect(fixture).toContain("const adminAccount = 'testadmin'")
    expect(fixture).toContain("const adminPassword = 'VinciLocalTest!2026'")
    expect(fixture).toContain('if (!fixtures.length)')
    expect(fixture).not.toContain('fixtures.length !== 228')
    expect(fixture).toContain('applyCmsMemberMarkdownMigration()')
    expect(entrypoint).toContain('"$(id -u)" = "$(id -u node)"')
    expect(entrypoint).toContain('exec gosu node "$@"')
    expect(guide).toContain('articles=313,members=48')
    expect(guide).toContain('./scripts/cms-local-test.sh stop')
  })
})
