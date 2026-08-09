import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 深色模式切换', () => {
  it('复用全站主题契约并提供可访问、可持久化的 CMS 顶栏按钮', async () => {
    const [layout, tokens, config] = await Promise.all([
      readFile('app/layouts/cms.vue', 'utf8'),
      readFile('app/assets/css/tokens.css', 'utf8'),
      readFile('nuxt.config.ts', 'utf8')
    ])

    expect(layout).toContain('class="cms-theme-toggle"')
    expect(layout).toContain(':aria-label="themeLabel"')
    expect(layout).toContain(':aria-pressed="theme === \'dark\'"')
    expect(layout).toContain("localStorage.setItem('vinci-theme', nextTheme)")
    expect(layout).toContain('document.documentElement.dataset.theme = nextTheme')
    expect(layout).toContain("activeTheme === 'light' || activeTheme === 'dark'")
    expect(layout).toContain("matchMedia('(prefers-color-scheme: dark)')")
    expect(tokens).toContain(':root[data-theme="dark"]')
    expect(config).toContain("localStorage.getItem('vinci-theme')")
    expect(config).toContain('document.documentElement.dataset.theme = theme')
  })
})
