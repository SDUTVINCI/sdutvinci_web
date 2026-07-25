import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareMarkdownForVisualEditor } from '../app/utils/cms-protected-markdown'
import { assessMarkdownVisualSafety } from '../shared/utils/cms-markdown-safety'

describe('CMS 混合可视化 Markdown 保护', () => {
  it('只替换真正的 HTML/Vue 语法，不误判代码块和自动链接', () => {
    const markdown = `普通正文 <https://example.com>

详见<NuxtLink to="/wiki/test">\`教程\`</NuxtLink> <br>

\`\`\`cpp
#include <iostream>
\`\`\`

<section>
  <strong>旧内容</strong>
</section>
`
    const prepared = prepareMarkdownForVisualEditor(markdown)

    expect(prepared).toContain('<https://example.com>')
    expect(prepared).toContain('#include <iostream>')
    expect(prepared).not.toContain('<NuxtLink')
    expect(prepared).not.toContain('<br>')
    expect(prepared).not.toContain('<section>')
    expect(prepared.match(/VINCIEXTENSION/g)).toHaveLength(4)
  })

  it('所有正文都允许进入可视化模式', () => {
    expect(assessMarkdownVisualSafety('<NuxtLink to="/">首页</NuxtLink>').allowed)
      .toBe(true)
    expect(assessMarkdownVisualSafety('{% include section.html %}').allowed)
      .toBe(true)
  })

  it('现有全部新闻和 Wiki 正文都能完成可视化预处理', async () => {
    const roots = ['content/news', 'content/wiki']
    const paths = (
      await Promise.all(roots.map(async root =>
        (await readdir(root, { recursive: true }))
          .filter(path => path.endsWith('.md'))
          .map(path => join(root, path))
      ))
    ).flat()

    expect(paths.length).toBeGreaterThan(200)
    for (const path of paths) {
      const source = await readFile(path, 'utf8')
      const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      expect(() => prepareMarkdownForVisualEditor(body), path).not.toThrow()
    }
  })
})
