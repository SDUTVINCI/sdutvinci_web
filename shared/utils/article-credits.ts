import type { PublicMember } from '../types/public-content'

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
  members: readonly PublicMember[]
) => {
  const memberByKey = new Map(members.map(member => [member.memberKey, member]))
  const authorKeys = [...new Set(stringList(authorsValue))]
  const authorSet = new Set(authorKeys)
  const collaboratorKeys = [...new Set(stringList(contributorsValue))]
    .filter(memberKey => !authorSet.has(memberKey))
  const resolve = (memberKey: string): ArticleCredit => {
    const member = memberByKey.get(memberKey)
    return {
      memberKey,
      name: member?.name || memberKey,
      image: typeof member?.image === 'string' ? member.image : null,
      path: member?.path || null
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
