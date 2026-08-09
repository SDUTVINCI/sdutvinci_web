import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 深色模式切换', () => {
  it('复用全站主题契约并提供可访问、可持久化的 CMS 顶栏按钮', async () => {
    const [layout, authLayout, tokens, config, cmsStyles] = await Promise.all([
      readFile('app/layouts/cms.vue', 'utf8'),
      readFile('app/layouts/cms-auth.vue', 'utf8'),
      readFile('app/assets/css/tokens.css', 'utf8'),
      readFile('nuxt.config.ts', 'utf8'),
      readFile('app/assets/css/cms.css', 'utf8')
    ])

    expect(layout).toContain('class="cms-theme-toggle"')
    expect(authLayout).toContain('class="cms-theme-toggle cms-auth-theme-toggle"')
    expect(authLayout).toContain("localStorage.setItem('vinci-theme', nextTheme)")
    expect(layout).toContain(':aria-label="themeLabel"')
    expect(layout).toContain(':aria-pressed="theme === \'dark\'"')
    expect(layout).toContain("localStorage.setItem('vinci-theme', nextTheme)")
    expect(layout).toContain('document.documentElement.dataset.theme = nextTheme')
    expect(layout).toContain("activeTheme === 'light' || activeTheme === 'dark'")
    expect(layout).toContain("matchMedia('(prefers-color-scheme: dark)')")
    expect(tokens).toContain(':root[data-theme="dark"]')
    expect(config).toContain("localStorage.getItem('vinci-theme')")
    expect(config).toContain('document.documentElement.dataset.theme = theme')
    expect(cmsStyles).toContain(':root[data-theme="light"] .cms-sidebar')
    expect(cmsStyles).toContain(':root[data-theme="light"] .cms-dashboard-hero')
    expect(cmsStyles).toContain(':root[data-theme="light"] .cms-auth-shell')
    expect(cmsStyles).toContain(':root[data-theme="light"] .cms-auth-card')
    expect(cmsStyles).toContain('rgba(244, 248, 246, 0.46) 100%')
    expect(cmsStyles).toContain(':root[data-theme="light"] .cms-login-capabilities')
    expect(cmsStyles).toContain('color-mix(in srgb, var(--cyan) 82%, var(--ink))')
    expect(cmsStyles).toContain('rgba(243, 247, 245, 0.97)')
    expect(cmsStyles).toContain('rgba(214, 224, 220, 0.62)')
    expect(cmsStyles).toContain('linear-gradient(135deg, #ffffff, #edf6f3 72%)')
    expect(cmsStyles).toMatch(/\.cms-editor-workspace\s*\{[^}]*overflow:\s*clip;/s)
    expect(cmsStyles).toMatch(/\.cms-milkdown-root \.milkdown \.milkdown-top-bar\s*\{[^}]*top:\s*68px;/s)
    expect(cmsStyles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.milkdown-top-bar\s*\{[^}]*top:\s*56px;/)
  })
})
