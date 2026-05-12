import { defineTransformer } from '@nuxt/content'
import { getWikiContentMeta } from '../utils/wiki-content-meta'

export default defineTransformer({
  name: 'wiki-pinyin-path',
  extensions: ['.md', '.mdc'],
  transform(content) {
    const stem = getStem(content.id)
    const wikiMeta = getWikiContentMeta(stem)

    if (!wikiMeta) {
      return content
    }

    return {
      ...content,
      ...wikiMeta,
    }
  }
})

function getStem(id: string) {
  const normalized = id.replace(/\\/g, '/')
  const withoutSource = normalized.includes(':')
    ? normalized.slice(normalized.indexOf(':') + 1)
    : normalized

  return withoutSource.replace(/\.(md|mdc)$/i, '')
}
