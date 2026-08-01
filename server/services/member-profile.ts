import { isIP } from 'node:net'
import { stringify } from 'yaml'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import { sha256ContentBytes } from './content-export-serialization'

export const MEMBER_MARKDOWN_EDITABLE_FIELDS = [
  'name',
  'image',
  'role',
  'type',
  'time',
  'advisor',
  'grade',
  'affiliation',
  'links',
  'body',
  'metadata',
  'sortOrder'
] as const

export type MemberEditableField = typeof MEMBER_MARKDOWN_EDITABLE_FIELDS[number]

export interface MemberProfileSnapshot {
  memberKey: string
  name: string
  avatarUrl: string | null
  sourcePath: string
  role: string | null
  memberType: string | null
  seasons: string[]
  advisorSeasons: string[]
  grade: string | null
  affiliation: string | null
  links: Record<string, string | null>
  body: string
  sortOrder: number
  metadata: Record<string, unknown>
}

const memberKeyPattern = /^[a-z][a-z0-9]{2,31}$/
const sensitiveKeyPattern = /^(?:account|accounts|login|loginid|login_id|username|user_id|userid|password|password_hash|roles?|permissions?|binding|member_id|sessions?|security|status|token|secret)$/i
const knownFrontmatterKeys = new Set([
  'id', 'name', 'image', 'role', 'type', 'time', 'advisor', 'grade',
  'affiliation', 'links', 'metadata', 'sortOrder'
])

const stringOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  return String(value).trim() || null
}

export const normalizeMemberSeasons = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return []
  const values = Array.isArray(value) ? value : String(value).split(/[/,，]/)
  return [...new Set(values.map(item => String(item).trim()).filter(Boolean))]
}

const safeObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const safeLinks = (value: unknown): Record<string, string | null> => {
  const links: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(safeObject(value))) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(key)) {
      throw new Error('MEMBER_LINK_KEY_INVALID')
    }
    links[key] = stringOrNull(item)
  }
  return links
}

const privateIpv4 = (hostname: string) => {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0
}

const privateIpv6 = (hostname: string) => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
}

export const isSafeMemberPublicUrl = (value: string, allowRootRelative = false) => {
  const trimmed = value.trim()
  if (allowRootRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return !trimmed.includes('\\') && !/[\u0000-\u001f\u007f]/.test(trimmed)
  }
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001f\u007f]/.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    const hostname = url.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false
    const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ''))
    if ((ipVersion === 4 && privateIpv4(hostname)) || (ipVersion === 6 && privateIpv6(hostname))) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export const assertSafeMemberAvatarUrl = (value: string | null) => {
  if (value !== null && !isSafeMemberPublicUrl(value, true)) {
    throw new Error('MEMBER_AVATAR_URL_UNSAFE')
  }
}

const assertNoSensitiveKeys = (value: unknown, path = 'metadata') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKeyPattern.test(key.replaceAll('-', '_'))) {
      throw new Error(`MEMBER_SENSITIVE_FIELD_REJECTED:${path}.${key}`)
    }
    assertNoSensitiveKeys(item, `${path}.${key}`)
  }
}

export const memberProfileFromMarkdown = (
  source: string,
  sourcePath: string,
  options: { allowLegacyUnknownFields?: boolean, sortOrder?: number } = {}
): MemberProfileSnapshot => {
  const parsed = parseCmsMarkdown(source)
  const memberKey = stringOrNull(parsed.frontmatter.id)?.toLowerCase() || ''
  const name = stringOrNull(parsed.frontmatter.name) || ''
  if (!memberKeyPattern.test(memberKey)) throw new Error('MEMBER_KEY_INVALID')
  if (!name || name.length > 100) throw new Error('MEMBER_NAME_INVALID')

  const unknown = Object.fromEntries(
    Object.entries(parsed.frontmatter).filter(([key]) => !knownFrontmatterKeys.has(key))
  )
  if (!options.allowLegacyUnknownFields && Object.keys(unknown).length) {
    throw new Error(`MEMBER_FIELD_NOT_EDITABLE:${Object.keys(unknown).sort().join(',')}`)
  }
  const metadata = {
    ...unknown,
    ...safeObject(parsed.frontmatter.metadata)
  }
  assertNoSensitiveKeys(metadata)

  const avatarUrl = stringOrNull(parsed.frontmatter.image)
  assertSafeMemberAvatarUrl(avatarUrl)
  const links = safeLinks(parsed.frontmatter.links)
  for (const value of Object.values(links)) {
    if (value !== null && !isSafeMemberPublicUrl(value)) {
      throw new Error('MEMBER_LINK_URL_UNSAFE')
    }
  }
  const sortOrderValue = parsed.frontmatter.sortOrder ?? options.sortOrder ?? 0
  const sortOrder = Number(sortOrderValue)
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    throw new Error('MEMBER_SORT_ORDER_INVALID')
  }
  if (Buffer.byteLength(parsed.body) > 1_000_000) throw new Error('MEMBER_BODY_TOO_LARGE')

  return {
    memberKey,
    name,
    avatarUrl,
    sourcePath,
    role: stringOrNull(parsed.frontmatter.role),
    memberType: stringOrNull(parsed.frontmatter.type),
    seasons: normalizeMemberSeasons(parsed.frontmatter.time),
    advisorSeasons: normalizeMemberSeasons(parsed.frontmatter.advisor),
    grade: stringOrNull(parsed.frontmatter.grade),
    affiliation: stringOrNull(parsed.frontmatter.affiliation),
    links,
    body: parsed.body.replace(/\r\n?/g, '\n'),
    sortOrder,
    metadata
  }
}

const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeValue(item)]))
  }
  return value
}

export const serializeMemberProfile = (profile: MemberProfileSnapshot) => {
  if (!memberKeyPattern.test(profile.memberKey)) throw new Error('MEMBER_KEY_INVALID')
  if (!profile.name.trim() || profile.name.length > 100) throw new Error('MEMBER_NAME_INVALID')
  assertSafeMemberAvatarUrl(profile.avatarUrl)
  assertNoSensitiveKeys(profile.metadata)
  for (const [key, value] of Object.entries(profile.links)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(key)) throw new Error('MEMBER_LINK_KEY_INVALID')
    if (value !== null && !isSafeMemberPublicUrl(value)) throw new Error('MEMBER_LINK_URL_UNSAFE')
  }
  const frontmatter: Record<string, unknown> = {
    id: profile.memberKey,
    name: profile.name,
    image: profile.avatarUrl,
    role: profile.role,
    type: profile.memberType,
    time: profile.seasons.length ? profile.seasons.join(',') : null,
    advisor: profile.advisorSeasons.length ? profile.advisorSeasons.join(',') : null,
    grade: profile.grade,
    affiliation: profile.affiliation,
    links: Object.keys(profile.links).length ? normalizeValue(profile.links) : null
  }
  if (profile.sortOrder !== 0) frontmatter.sortOrder = profile.sortOrder
  if (Object.keys(profile.metadata).length) frontmatter.metadata = normalizeValue(profile.metadata)
  const yaml = stringify(frontmatter, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN'
  }).replace(/\r\n?/g, '\n').trimEnd()
  const body = profile.body.replace(/\r\n?/g, '\n').replace(/\n*$/, '')
  const source = `---\n${yaml}\n---\n${body}${body ? '\n' : ''}`
  return {
    path: `members/${profile.sourcePath}`,
    source,
    sha256: sha256ContentBytes(source),
    bytes: Buffer.byteLength(source)
  }
}

export const profileRecord = (profile: MemberProfileSnapshot): Record<string, unknown> => ({
  memberKey: profile.memberKey,
  name: profile.name,
  avatarUrl: profile.avatarUrl,
  sourcePath: profile.sourcePath,
  role: profile.role,
  memberType: profile.memberType,
  seasons: profile.seasons,
  advisorSeasons: profile.advisorSeasons,
  grade: profile.grade,
  affiliation: profile.affiliation,
  links: profile.links,
  body: profile.body,
  sortOrder: profile.sortOrder,
  metadata: profile.metadata
})

export const profileFromRecord = (value: Record<string, unknown>): MemberProfileSnapshot => ({
  memberKey: String(value.memberKey || ''),
  name: String(value.name || ''),
  avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
  sourcePath: String(value.sourcePath || ''),
  role: typeof value.role === 'string' ? value.role : null,
  memberType: typeof value.memberType === 'string' ? value.memberType : null,
  seasons: normalizeMemberSeasons(value.seasons),
  advisorSeasons: normalizeMemberSeasons(value.advisorSeasons),
  grade: typeof value.grade === 'string' ? value.grade : null,
  affiliation: typeof value.affiliation === 'string' ? value.affiliation : null,
  links: safeLinks(value.links),
  body: typeof value.body === 'string' ? value.body : '',
  sortOrder: Number(value.sortOrder || 0),
  metadata: safeObject(value.metadata)
})

export const memberFieldDiff = (
  base: MemberProfileSnapshot,
  next: MemberProfileSnapshot
) => {
  const changes: Record<string, { from: unknown, to: unknown }> = {}
  for (const field of MEMBER_MARKDOWN_EDITABLE_FIELDS) {
      const key = field === 'image' ? 'avatarUrl'
        : field === 'type' ? 'memberType'
          : field === 'time' ? 'seasons'
            : field === 'advisor' ? 'advisorSeasons'
              : field
      const left = base[key as keyof MemberProfileSnapshot]
      const right = next[key as keyof MemberProfileSnapshot]
      if (JSON.stringify(left) !== JSON.stringify(right)) {
        changes[field] = { from: left ?? null, to: right ?? null }
      }
  }
  return changes
}

export const mergeMemberProfiles = (
  base: MemberProfileSnapshot,
  current: MemberProfileSnapshot,
  proposed: MemberProfileSnapshot
) => {
  const currentDiff = memberFieldDiff(base, current)
  const proposedDiff = memberFieldDiff(base, proposed)
  const conflicts = Object.keys(proposedDiff).filter((field) =>
    field in currentDiff
    && JSON.stringify(currentDiff[field]) !== JSON.stringify(proposedDiff[field])
  )
  if (conflicts.length) return { merged: null, conflicts, currentDiff, proposedDiff }
  const merged = { ...current } as MemberProfileSnapshot
  for (const field of Object.keys(proposedDiff) as MemberEditableField[]) {
    const sourceKey = field === 'image' ? 'avatarUrl'
      : field === 'type' ? 'memberType'
        : field === 'time' ? 'seasons'
          : field === 'advisor' ? 'advisorSeasons'
            : field
    ;(merged as unknown as Record<string, unknown>)[sourceKey] =
      (proposed as unknown as Record<string, unknown>)[sourceKey]
  }
  return { merged, conflicts: [], currentDiff, proposedDiff }
}
