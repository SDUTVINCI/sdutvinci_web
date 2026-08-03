export type VinciContentComponentId =
  | 'alert'
  | 'parameter-card'
  | 'video'
  | 'download-card'

export interface VinciContentComponentDefinition {
  id: VinciContentComponentId
  tag: `vinci-${VinciContentComponentId}`
  label: string
  description: string
  defaultMarkdown: string
}

export interface VinciContentComponentOccurrence {
  definition: VinciContentComponentDefinition
  start: number
  end: number
  source: string
  closed: boolean
}

export const vinciContentComponentDefinitions: readonly VinciContentComponentDefinition[] = [
  {
    id: 'alert',
    tag: 'vinci-alert',
    label: '提示框',
    description: '用于提示、注意、警告或成功信息。',
    defaultMarkdown: `::vinci-alert{tone="info" title="提示"}
在这里填写提示内容。
::`
  },
  {
    id: 'parameter-card',
    tag: 'vinci-parameter-card',
    label: '参数卡',
    description: '用表格展示设备、项目或方案参数。',
    defaultMarkdown: `::vinci-parameter-card{title="参数"}
| 项目 | 数值 |
| --- | --- |
| 示例参数 | 示例数值 |
::`
  },
  {
    id: 'video',
    tag: 'vinci-video',
    label: '视频',
    description: '嵌入 HTTPS 或站内视频地址。',
    defaultMarkdown: `::vinci-video{src="https://example.com/embed" title="视频"}
::`
  },
  {
    id: 'download-card',
    tag: 'vinci-download-card',
    label: '下载卡片',
    description: '提供文件名称、说明和下载链接。',
    defaultMarkdown: `::vinci-download-card{href="/downloads/example.pdf" title="资料下载" description="文件说明"}
::`
  }
] as const

const definitionsByTag = new Map<string, VinciContentComponentDefinition>(
  vinciContentComponentDefinitions.map(definition => [definition.tag, definition])
)

const linePattern = /.*(?:\n|$)/g
const openingPattern = /^\s*(:{2,})([A-Za-z][\w-]*)(?:\{|\s|$)/
const closingPattern = /^\s*(:{2,})\s*$/
const codeFencePattern = /^\s*(`{3,}|~{3,})/

interface OpenComponent {
  fence: string
  tag: string
  start: number
}

export const findVinciContentComponents = (
  markdown: string
): VinciContentComponentOccurrence[] => {
  const occurrences: VinciContentComponentOccurrence[] = []
  const stack: OpenComponent[] = []
  let codeFence: { marker: '`' | '~', length: number } | null = null

  for (const match of markdown.matchAll(linePattern)) {
    const source = match[0]
    if (!source) continue
    const line = source.replace(/\n$/, '').replace(/\r$/, '')
    const start = match.index
    const end = start + source.length
    const fenceMatch = codeFencePattern.exec(line)

    if (fenceMatch) {
      const fence = fenceMatch[1]!
      const marker = fence[0] as '`' | '~'
      if (!codeFence) {
        codeFence = { marker, length: fence.length }
      } else if (codeFence.marker === marker && fence.length >= codeFence.length) {
        codeFence = null
      }
      continue
    }
    if (codeFence) continue

    const closing = closingPattern.exec(line)
    if (closing) {
      const fence = closing[1]!
      const index = stack.findLastIndex(open => open.fence === fence)
      if (index < 0) continue
      const [open] = stack.splice(index, 1)
      const definition = definitionsByTag.get(open!.tag)
      if (definition) {
        const componentEnd = source.endsWith('\n') ? end - 1 : end
        occurrences.push({
          definition,
          start: open!.start,
          end: componentEnd,
          source: markdown.slice(open!.start, componentEnd),
          closed: true
        })
      }
      continue
    }

    const opening = openingPattern.exec(line)
    if (!opening) continue
    stack.push({
      fence: opening[1]!,
      tag: opening[2]!.toLowerCase(),
      start
    })
  }

  for (const open of stack) {
    const definition = definitionsByTag.get(open.tag)
    if (!definition) continue
    occurrences.push({
      definition,
      start: open.start,
      end: markdown.length,
      source: markdown.slice(open.start),
      closed: false
    })
  }

  return occurrences.sort((left, right) => left.start - right.start)
}

export const isRegisteredVinciComponentSource = (
  source: string,
  expectedTag?: string
) => {
  const opening = openingPattern.exec(source.split(/\r?\n/, 1)[0] || '')
  if (!opening) return false
  const tag = opening[2]!.toLowerCase()
  return definitionsByTag.has(tag) && (!expectedTag || tag === expectedTag)
}
