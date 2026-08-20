import { describe, expect, it } from 'vitest'
import {
  WIKI_DOCUMENT_TAGS,
  WIKI_UNCATEGORIZED_TAG,
  isWikiDocumentIndexPath,
  normalizeWikiDocumentTags,
  wikiDocumentIndexPath
} from '../shared/utils/wiki-tags'

describe('Wiki 文档标签', () => {
  it('只接受固定标签、去重并按固定顺序返回', () => {
    expect(normalizeWikiDocumentTags([
      '软件算法组',
      '嵌入式组',
      '软件算法组'
    ])).toEqual(['嵌入式组', '软件算法组'])
    expect(normalizeWikiDocumentTags([...WIKI_DOCUMENT_TAGS]))
      .toEqual(WIKI_DOCUMENT_TAGS)
  })

  it.each([
    undefined,
    null,
    [],
    '嵌入式组',
    ['嵌入式组', '非法标签'],
    ['嵌入式组', 1],
    [' 嵌入式组 ']
  ])('缺失、空值或任何非法值都明确归为未分类', (value) => {
    expect(normalizeWikiDocumentTags(value)).toEqual([WIKI_UNCATEGORIZED_TAG])
  })

  it('所有章节都只映射到一级资料目录的 index.md', () => {
    expect(wikiDocumentIndexPath('资料/index.md')).toBe('资料/index.md')
    expect(wikiDocumentIndexPath('资料/0100-开始.md')).toBe('资料/index.md')
    expect(wikiDocumentIndexPath('资料/子目录/0200-继续.md')).toBe('资料/index.md')
    expect(wikiDocumentIndexPath('单文件.md')).toBeNull()
    expect(isWikiDocumentIndexPath('资料/index.md')).toBe(true)
    expect(isWikiDocumentIndexPath('资料/章节.md')).toBe(false)
    expect(isWikiDocumentIndexPath('资料/子目录/index.md')).toBe(false)
  })
})
