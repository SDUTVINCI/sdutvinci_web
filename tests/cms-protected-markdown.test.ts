import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import {
  collectCmsProtectedMarkdownSources,
  prepareMarkdownForVisualEditor
} from '../app/utils/cms-protected-markdown'
import {
  assessCmsVisualRoundTrip,
  canonicalizeCmsRenderingTree,
  cmsVisualEditorFeatures,
  isCmsVisualRoundTripLossless
} from '../app/utils/cms-visual-editor'
import { assessMarkdownVisualSafety } from '../shared/utils/cms-markdown-safety'
import { vinciContentComponentDefinitions } from '../shared/utils/vinci-content-components'

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

  it('按最终网页效果接受等价规范化，并严格保留扩展语法', async () => {
    const bareLink = '访问 https://example.com/path 获取资料。'
    const normalizedLink = '访问 <https://example.com/path> 获取资料。'
    expect(isCmsVisualRoundTripLossless(bareLink, normalizedLink)).toBe(false)
    await expect(assessCmsVisualRoundTrip(bareLink, normalizedLink)).resolves.toEqual({
      safe: true,
      reason: 'equivalent'
    })

    const protectedSource = '<!-- 原始注释 -->\n\n<iframe src="/embed"></iframe>'
    expect(collectCmsProtectedMarkdownSources(protectedSource)).toEqual([
      '<!-- 原始注释 -->',
      '<iframe src="/embed"></iframe>'
    ])
    await expect(assessCmsVisualRoundTrip(
      protectedSource,
      protectedSource.replace('原始注释', '被修改的注释')
    )).resolves.toEqual({
      safe: false,
      reason: 'protected_syntax_changed'
    })
  })

  it('忽略 Shiki 纯表现 token 差异但保留代码语言与原文比较', () => {
    const lightComment = [[
      'pre',
      { language: 'cpp', class: 'shiki shiki-themes github-light github-dark' },
      ['code', { class: 'language-cpp' }, [
        'span',
        { class: 'line', style: 'display:inline' },
        ['span', { style: 'color:#24292E;--shiki-dark:#6A737D' }, '\t// 注释']
      ]]
    ]] as any
    const scopedComment = [[
      'pre',
      { language: 'cpp', class: 'shiki shiki-themes github-light github-dark' },
      ['code', { class: 'language-cpp' }, [
        'span',
        { class: 'line', style: 'display:inline' },
        ['span', { style: 'color:#6A737D;--shiki-dark:#6A737D' }, '\t// 注释']
      ]]
    ]] as any

    expect(canonicalizeCmsRenderingTree(lightComment)).toEqual(
      canonicalizeCmsRenderingTree(scopedComment)
    )
    expect(canonicalizeCmsRenderingTree(lightComment)).toEqual([
      ['pre', { language: 'cpp' }, ['code', {}, '\t// 注释']]
    ])
  })

  it('C++ 首次高亮差异不阻止富文本，真实列表结构变化仍阻止', async () => {
    const cppSource = '```cpp\nint main() {\n\n\t// 指针注释\n\treturn 0;\n}\n```'
    await expect(assessCmsVisualRoundTrip(cppSource, cppSource)).resolves.toEqual({
      safe: true,
      reason: 'equivalent'
    })

    const legacyList = `1. 外层

    1. ARM

    10. X86

        1. 应用

    11. LoongArch`
    const changedStructure = `1. 外层

   1. ARM

10. X86

    1. 应用

11. LoongArch`
    await expect(assessCmsVisualRoundTrip(legacyList, changedStructure)).resolves.toEqual({
      safe: false,
      reason: 'rendering_changed'
    })
  })

  it('保留独立 Markdown 图片的可访问说明并拒绝有损往返', () => {
    const source = `正文

![Vinci 机器人队参加 Robocon 排球赛](/images/news/competition.jpg)

下一段
`
    const corrupted = source.replace(
      '![Vinci 机器人队参加 Robocon 排球赛]',
      '![1.00]'
    )

    expect(cmsVisualEditorFeatures[Crepe.Feature.ImageBlock]).toBe(false)
    expect(prepareMarkdownForVisualEditor(source)).toBe(source)
    expect(isCmsVisualRoundTripLossless(source, source.replace(/\n\n/g, '\n\n\n')))
      .toBe(true)
    expect(isCmsVisualRoundTripLossless(source, corrupted)).toBe(false)
    expect(isCmsVisualRoundTripLossless(
      '```text\n第一行\n\n第三行\n```',
      '```text\n第一行\n第三行\n```'
    )).toBe(false)
  })

  it('系统登记组件进入富文本保护管线且 Markdown 原文可完整还原', () => {
    for (const definition of vinciContentComponentDefinitions) {
      const prepared = prepareMarkdownForVisualEditor(definition.defaultMarkdown)
      expect(prepared).toBe(definition.defaultMarkdown)
      expect(assessMarkdownVisualSafety(prepared).reasons)
        .toContain('正文包含 MDC 容器语法，将在可视化模式中作为只读区域保护')
      expect(isCmsVisualRoundTripLossless(
        definition.defaultMarkdown,
        definition.defaultMarkdown
      )).toBe(true)
    }
  })

  it('现有全部新闻和 Wiki 正文都能完成可视化预处理', async () => {
    const snapshotSource = process.env.V2_CONTENT_SNAPSHOT_SOURCE
    expect(snapshotSource, 'V2_CONTENT_SNAPSHOT_SOURCE 必须指向独立内容仓库快照')
      .toBeTruthy()
    const roots = ['news', 'wiki'].map(area => resolve(snapshotSource!, area))
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
