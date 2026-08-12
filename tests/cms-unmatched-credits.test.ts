import { describe, expect, it } from 'vitest'
import {
  CMS_UNMATCHED_AUTHORS_KEY,
  CMS_UNMATCHED_CONTRIBUTORS_KEY
} from '../server/services/cms-drafts'
import { buildPublishedSource } from '../server/services/cms-publishing-legacy'

describe('CMS 无成员档案署名发布', () => {
  it('合并已匹配与原始人名，并且不把内部保存字段写进公开 Frontmatter', () => {
    const result = buildPublishedSource({
      preservedFrontmatter: {
        contributors: ['known-contributor'],
        [CMS_UNMATCHED_AUTHORS_KEY]: ['外部作者'],
        [CMS_UNMATCHED_CONTRIBUTORS_KEY]: ['外部编辑']
      },
      title: '保留无法匹配署名',
      description: '',
      authorKeys: ['known-author'],
      body: '正文。\n',
      now: new Date('2026-08-12T00:00:00.000Z')
    })

    expect(result.frontmatter.authors).toEqual(['known-author', '外部作者'])
    expect(result.frontmatter.contributors).toEqual(['known-contributor', '外部编辑'])
    expect(result.source).not.toContain(CMS_UNMATCHED_AUTHORS_KEY)
    expect(result.source).not.toContain(CMS_UNMATCHED_CONTRIBUTORS_KEY)
  })
})
