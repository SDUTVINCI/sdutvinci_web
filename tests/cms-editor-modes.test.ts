import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'comark'
import {
  findVinciContentComponents,
  isRegisteredVinciComponentSource,
  vinciContentComponentDefinitions
} from '../shared/utils/vinci-content-components'
import {
  createVinciMarkdownPlugins,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'
import {
  getScrollProgress,
  getScrollTopForProgress
} from '../app/utils/cms-scroll-sync'
import { numberWikiHeadings } from '../app/utils/wiki-heading-numbering'

describe('CMS 沉浸式编辑、双栏预览与内容组件', () => {
  it('登记组件可确定性插入、定位和原文编辑，不误判代码或未知语法', () => {
    const source = `${vinciContentComponentDefinitions[0]!.defaultMarkdown}

\`\`\`markdown
::vinci-video{src="https://code.example"}
::
\`\`\`

::unknown-widget{answer="42"}
未知组件保持原文
::

${vinciContentComponentDefinitions[3]!.defaultMarkdown}`
    const occurrences = findVinciContentComponents(source)

    expect(occurrences.map(item => item.definition.id)).toEqual([
      'alert',
      'download-card'
    ])
    expect(occurrences.every(item => item.closed)).toBe(true)
    expect(occurrences.every(item => source.slice(item.start, item.end).trimEnd() === item.source))
      .toBe(true)
    expect(isRegisteredVinciComponentSource(
      occurrences[0]!.source.replace('title="提示"', 'title="注意"'),
      'vinci-alert'
    )).toBe(true)
    expect(isRegisteredVinciComponentSource('::unknown-widget\n::')).toBe(false)
  })

  it('源码滚动映射会钳制范围，内容刷新后可恢复相同比例而不回到顶部', () => {
    expect(getScrollProgress(450, 1_000, 100)).toBe(0.5)
    expect(getScrollProgress(-20, 1_000, 100)).toBe(0)
    expect(getScrollProgress(2_000, 1_000, 100)).toBe(1)
    expect(getScrollTopForProgress(0.5, 2_000, 200)).toBe(900)
    expect(getScrollTopForProgress(0.5, 2_400, 200)).toBe(1_100)
  })

  it('CMS Wiki 预览与正式页面共用跳级兼容的标题编号', () => {
    expect(numberWikiHeadings([
      { id: 'a', text: 'A', depth: 2 },
      { id: 'b', text: 'B', depth: 4 },
      { id: 'c', text: 'C', depth: 4 },
      { id: 'd', text: 'D', depth: 3 },
      { id: 'e', text: 'E', depth: 2 }
    ])).toEqual([
      { id: 'a', text: 'A', depth: 2, level: 1, number: '1' },
      { id: 'b', text: 'B', depth: 4, level: 2, number: '1.1' },
      { id: 'c', text: 'C', depth: 4, level: 2, number: '1.2' },
      { id: 'd', text: 'D', depth: 3, level: 1, number: '2' },
      { id: 'e', text: 'E', depth: 2, level: 1, number: '3' }
    ])
  })

  it('最终渲染允许普通 HTML、iframe 和登记组件，只阻断直接执行脚本的写法', async () => {
    const source = `${vinciContentComponentDefinitions.map(item => item.defaultMarkdown).join('\n\n')}

<style>.legacy { color: red }</style>
<object data="/legacy.bin"></object>
<unknown-widget data-value="kept">原文</unknown-widget>
<iframe src="https://example.com/embed" onload="alert(1)"></iframe>
<script data-original="kept">alert('xss')</script>
<a href="javascript:alert(1)" onclick="alert(2)">危险链接</a>
<a href="java&#x09;script&#58;alert(3)">编码危险链接</a>`
    const tree = await parse(source, {
      ...vinciMarkdownOptions,
      plugins: createVinciMarkdownPlugins()
    })
    const serialized = JSON.stringify(tree.nodes)

    for (const definition of vinciContentComponentDefinitions) {
      expect(serialized).toContain(`"${definition.tag}"`)
    }
    expect(serialized).toContain('"style"')
    expect(serialized).toContain('"object"')
    expect(serialized).toContain('"unknown-widget"')
    expect(serialized).toContain('https://example.com/embed')
    expect(serialized).not.toContain('"onload"')
    expect(serialized).not.toContain('"onclick"')
    expect(serialized).not.toContain('javascript:')
    expect(serialized).not.toContain('["script"')
    expect(serialized).toContain('data-vinci-blocked-tag')
  })

  it('页面使用富文本单栏、桌面源码双栏、移动切换和同一正式渲染器', async () => {
    const [page, sourceEditor, visualEditor, renderer] = await Promise.all([
      readFile('app/pages/cms/drafts/[id].vue', 'utf8'),
      readFile('app/components/cms/CmsMarkdownSourceEditor.client.vue', 'utf8'),
      readFile('app/components/cms/CmsMarkdownVisualEditor.client.vue', 'utf8'),
      readFile('app/components/VinciMarkdownRenderer.vue', 'utf8')
    ])

    expect(page).toContain("ref<'source' | 'visual'>('source')")
    expect(page).toContain('cms-source-workspace')
    expect(page).toContain('cms-source-mobile-switch')
    expect(page).toContain('@scroll-progress="handleSourceScroll"')
    expect(page).toContain('<VinciMarkdownRenderer :variant="initial.collection" :markdown="body" />')
    expect(page).not.toContain("switchMode('preview')")
    expect(sourceEditor).toContain('scrollProgress')
    expect(sourceEditor).toContain('getScrollProgress')
    expect(visualEditor).toContain('createCmsVisualEditorFeatureConfigs')
    expect(renderer).toContain("'vinci-alert': VinciAlert")
    expect(renderer).toContain("'vinci-download-card': VinciDownloadCard")
    expect(renderer).toContain("'content-prose': variant === 'news'")
    expect(renderer).toContain("'member-prose': variant === 'member'")
    expect(renderer).toContain('collectNumberedWikiHeadings')
  })
})
