import type { PublicArticleCreditIdentity } from '../types/article-credit-identities'

export interface ArticleCredit {
  memberKey: string
  name: string
  image: string | null
  path: string | null
}

const stringList = (value: unknown) => Array.isArray(value)
  ? value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
  : []

export const resolveArticleCredits = (
  authorsValue: unknown,
  contributorsValue: unknown,
  identities: readonly PublicArticleCreditIdentity[]
) => {
  const identityByKey = new Map(identities.map(identity => [identity.memberKey, identity]))
  const authorKeys = [...new Set(stringList(authorsValue))]
  const authorSet = new Set(authorKeys)
  const collaboratorKeys = [...new Set(stringList(contributorsValue))]
    .filter(memberKey => !authorSet.has(memberKey))
  const resolve = (memberKey: string): ArticleCredit => {
    const identity = identityByKey.get(memberKey)
    return {
      memberKey,
      name: identity?.name || memberKey,
      image: typeof identity?.image === 'string' ? identity.image : null,
      path: identity?.path || null
    }
  }

  return {
    authors: authorKeys.map(resolve),
    collaborators: collaboratorKeys.map(resolve)
  }
}

export const formatArticleCreditDate = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}
