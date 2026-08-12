import { createHash, randomBytes } from 'node:crypto'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { and, asc, eq, like, lt } from 'drizzle-orm'
import { pinyin } from 'pinyin-pro'
import { getDatabase } from '../db/client'
import { memberApplications, memberCohorts, members } from '../db/schema'
import { getCmsMediaConfig } from '../utils/cms-media-config'
import { createCmsMember } from './cms-members'
import { deriveMemberRole, deriveMemberType, normalizeMemberPositions } from './member-profile'
import { MEMBER_COLLEGE_OPTIONS } from '../../shared/constants/member-colleges'
import {
  deleteMemberAvatarObject,
  prepareMemberAvatar,
  promoteMemberApplicationAvatar,
  uploadMemberAvatarObject
} from './member-avatar-storage'

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const storage = () => {
  const config = getCmsMediaConfig()
  return { config, client: new S3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } }) }
}
const safeName = (name: string) => name.normalize('NFC').replace(/[/\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
const normalizeApplicationLinks = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const links: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined || item === '') continue
    if (typeof item !== 'string') throw new Error('MEMBER_APPLICATION_PROFILE_INVALID')
    const trimmed = item.trim()
    if (trimmed) links[key] = trimmed
  }
  return links
}

const ownedApplication = async (id: string, token: string) => {
  const [application] = await getDatabase().select().from(memberApplications).where(and(
    eq(memberApplications.id, id), eq(memberApplications.accessTokenHash, tokenHash(token))
  )).limit(1)
  if (!application) throw new Error('MEMBER_APPLICATION_NOT_FOUND')
  return application
}

export const cleanupExpiredMemberApplications = async (now = new Date()) => {
  const expired = await getDatabase().select().from(memberApplications).where(and(
    eq(memberApplications.status, 'editing'), lt(memberApplications.expiresAt, now)
  ))
  if (!expired.length) return 0
  let storageDependencies: ReturnType<typeof storage> | undefined
  for (const item of expired) {
    if (item.avatarObjectKey) {
      storageDependencies ||= storage()
      try { await storageDependencies.client.send(new DeleteObjectCommand({ Bucket: storageDependencies.config.S3_BUCKET, Key: item.avatarObjectKey })) } catch { continue }
    }
    await getDatabase().update(memberApplications).set({ status: 'abandoned', updatedAt: now }).where(eq(memberApplications.id, item.id))
  }
  return expired.length
}

export const startMemberApplication = async () => {
  await cleanupExpiredMemberApplications()
  const token = randomBytes(32).toString('base64url')
  const [row] = await getDatabase().insert(memberApplications).values({
    accessTokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
  }).returning({ id: memberApplications.id, expiresAt: memberApplications.expiresAt })
  return { id: row!.id, token, expiresAt: row!.expiresAt.toISOString() }
}

export const uploadMemberApplicationAvatar = async (input: { id: string, token: string, name: string, data: Buffer, mimeType: string }) => {
  const application = await ownedApplication(input.id, input.token)
  if (application.status !== 'editing' || application.expiresAt < new Date()) throw new Error('MEMBER_APPLICATION_STATE_INVALID')
  const { output, filename } = await prepareMemberAvatar(input)
  const key = `member-applications/${new Date().getUTCFullYear()}/${filename}`
  const { config, client } = storage()
  const { url } = await uploadMemberAvatarObject({
    key,
    output,
    cacheControl: 'private, max-age=86400',
    metadata: { 'member-application-id': input.id }
  })
  if (application.avatarObjectKey && application.avatarObjectKey !== key) {
    await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: application.avatarObjectKey }))
  }
  await getDatabase().update(memberApplications).set({ avatarObjectKey: key, avatarPublicUrl: url, avatarByteSize: output.length, updatedAt: new Date() }).where(eq(memberApplications.id, input.id))
  return { url, filename }
}

export const submitMemberApplication = async (id: string, token: string, profile: Record<string, unknown>) => {
  const application = await ownedApplication(id, token)
  if (application.status !== 'editing' || application.expiresAt < new Date()) throw new Error('MEMBER_APPLICATION_STATE_INVALID')
  const name = safeName(String(profile.name || ''))
  const grade = Number(profile.grade)
  const [cohort] = await getDatabase().select().from(memberCohorts).where(and(eq(memberCohorts.gradeYear, grade), eq(memberCohorts.active, true))).limit(1)
  const groupName = String(profile.groupName || '').trim()
  const affiliation = String(profile.affiliation || '').trim()
  const positions = normalizeMemberPositions(profile.positions)
  const requestedSeasons = Array.isArray(profile.seasons) ? [...new Set(profile.seasons.map(value => String(value).trim()).filter(Boolean))] : []
  const advisorSeasons = Array.isArray(profile.advisorSeasons) ? [...new Set(profile.advisorSeasons.map(value => String(value).trim()).filter(Boolean))] : []
  const activeSeasons = new Set((await getDatabase().select({ season: memberCohorts.season }).from(memberCohorts).where(eq(memberCohorts.active, true))).map(item => item.season))
  if (!name || !cohort || (groupName && !cohort.groups.includes(groupName)) || !positions.length
    || !requestedSeasons.length || requestedSeasons.some(season => !activeSeasons.has(season))
    || advisorSeasons.some(season => !activeSeasons.has(season))
    || (affiliation && !(MEMBER_COLLEGE_OPTIONS as readonly string[]).includes(affiliation))) throw new Error('MEMBER_APPLICATION_PROFILE_INVALID')
  const normalized = {
    name, grade: String(grade), seasons: requestedSeasons, advisorSeasons,
    groupName: groupName || null, positions, affiliation: affiliation || null,
    links: normalizeApplicationLinks(profile.links), body: String(profile.body || ''),
    avatarUrl: application.avatarPublicUrl
  }
  await getDatabase().update(memberApplications).set({ profile: normalized, status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(memberApplications.id, id))
  return { id, status: 'submitted' }
}

export const abandonMemberApplication = async (id: string, token: string) => {
  const application = await ownedApplication(id, token)
  if (application.status !== 'editing') return
  if (application.avatarObjectKey) {
    const { config, client } = storage()
    await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: application.avatarObjectKey }))
  }
  await getDatabase().update(memberApplications).set({ status: 'abandoned', updatedAt: new Date() }).where(eq(memberApplications.id, id))
}

export const listSubmittedMemberApplications = async () => getDatabase().select().from(memberApplications)
  .where(eq(memberApplications.status, 'submitted')).orderBy(asc(memberApplications.createdAt))

const memberKeyFor = async (name: string) => {
  const base = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)
  const readable = base.length >= 3 ? base : 'member'
  const existing = new Set((await getDatabase().select({ memberKey: members.memberKey }).from(members)
    .where(like(members.memberKey, `${readable}%`))).map(item => item.memberKey))
  if (!existing.has(readable)) return readable
  for (let suffix = 1; suffix < 1_000_000; suffix += 1) {
    const candidate = `${readable.slice(0, 32 - String(suffix).length)}${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error('MEMBER_KEY_EXHAUSTED')
}

export const reviewMemberApplication = async (id: string, action: 'approve' | 'reject', note: string, actorUserId: string) => {
  const [application] = await getDatabase().select().from(memberApplications).where(eq(memberApplications.id, id)).limit(1)
  if (!application || application.status !== 'submitted') throw new Error('MEMBER_APPLICATION_STATE_INVALID')
  if (action === 'reject') {
    if (application.avatarObjectKey) { const { config, client } = storage(); await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: application.avatarObjectKey })) }
    await getDatabase().update(memberApplications).set({ status: 'rejected', reviewNote: note, reviewedAt: new Date(), reviewedByUserId: actorUserId, updatedAt: new Date() }).where(eq(memberApplications.id, id))
    return { status: 'rejected' }
  }
  const profile = application.profile as any
  profile.links = normalizeApplicationLinks(profile.links)
  const memberKey = await memberKeyFor(profile.name)
  let promotedAvatar: Awaited<ReturnType<typeof promoteMemberApplicationAvatar>> | null = null
  if (application.avatarObjectKey) {
    promotedAvatar = await promoteMemberApplicationAvatar({
      sourceKey: application.avatarObjectKey,
      applicationId: application.id
    })
    profile.avatarUrl = promotedAvatar.url
  }
  let member
  try {
    member = await createCmsMember({
      ...profile,
      memberKey,
      sourcePath: `applications/${id}.md`,
      role: deriveMemberRole(profile.positions, profile.groupName),
      memberType: deriveMemberType(profile.positions, profile.groupName)
    }, actorUserId)
  } catch (error) {
    if (promotedAvatar) await deleteMemberAvatarObject(promotedAvatar.key).catch(() => undefined)
    throw error
  }
  await getDatabase().update(memberApplications).set({
    status: 'approved',
    approvedMemberId: member!.id,
    avatarObjectKey: promotedAvatar?.key || application.avatarObjectKey,
    avatarPublicUrl: promotedAvatar?.url || application.avatarPublicUrl,
    reviewNote: note,
    reviewedAt: new Date(),
    reviewedByUserId: actorUserId,
    updatedAt: new Date()
  }).where(eq(memberApplications.id, id))
  if (promotedAvatar && application.avatarObjectKey) {
    await deleteMemberAvatarObject(application.avatarObjectKey).catch(() => undefined)
  }
  return { status: 'approved', member }
}
