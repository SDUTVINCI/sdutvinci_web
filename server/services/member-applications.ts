import { createHash, randomBytes } from 'node:crypto'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { and, asc, eq, lt } from 'drizzle-orm'
import { pinyin } from 'pinyin-pro'
import sharp from 'sharp'
import { getDatabase } from '../db/client'
import { memberApplications, memberCohorts } from '../db/schema'
import { getCmsMediaConfig } from '../utils/cms-media-config'
import { createCmsMember } from './cms-members'
import { deriveMemberRole, deriveMemberType, normalizeMemberPositions } from './member-profile'
import { MEMBER_COLLEGE_OPTIONS } from '../../shared/constants/member-colleges'

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const contentHash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const storage = () => {
  const config = getCmsMediaConfig()
  return { config, client: new S3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY } }) }
}
const publicUrl = (base: string, key: string) => `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
const safeName = (name: string) => name.normalize('NFC').replace(/[/\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)

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
  const name = safeName(input.name)
  if (!name || input.data.length > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(input.mimeType)) throw new Error('MEMBER_APPLICATION_IMAGE_INVALID')
  const output = await sharp(input.data, { animated: true, failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 }).toBuffer()
  const hash = contentHash(output).slice(0, 8)
  const key = `member-applications/${new Date().getUTCFullYear()}/${name}-${hash}.webp`
  const { config, client } = storage()
  await client.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: output, ContentType: 'image/webp', CacheControl: 'private, max-age=86400', Metadata: { 'member-application-id': input.id } }))
  if (application.avatarObjectKey && application.avatarObjectKey !== key) {
    await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: application.avatarObjectKey }))
  }
  const url = publicUrl(config.S3_PUBLIC_BASE_URL, key)
  await getDatabase().update(memberApplications).set({ avatarObjectKey: key, avatarPublicUrl: url, avatarByteSize: output.length, updatedAt: new Date() }).where(eq(memberApplications.id, input.id))
  return { url, filename: `${name}-${hash}.webp` }
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
  if (!name || !cohort || (groupName && !cohort.groups.includes(groupName)) || !positions.length
    || (affiliation && !(MEMBER_COLLEGE_OPTIONS as readonly string[]).includes(affiliation))) throw new Error('MEMBER_APPLICATION_PROFILE_INVALID')
  const normalized = {
    name, grade: String(grade), seasons: [cohort.season], advisorSeasons: Array.isArray(profile.advisorSeasons) ? profile.advisorSeasons : [],
    groupName: groupName || null, positions, affiliation: affiliation || null,
    links: profile.links && typeof profile.links === 'object' ? profile.links : {}, body: String(profile.body || ''),
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

const memberKeyFor = (name: string, id: string) => {
  const base = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)
  return `${base.length >= 3 ? base : 'member'}${id.replaceAll('-', '').slice(0, 8)}`.slice(0, 32)
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
  const member = await createCmsMember({ ...profile, memberKey: memberKeyFor(profile.name, id), sourcePath: `applications/${id}.md`, role: deriveMemberRole(profile.positions, profile.groupName), memberType: deriveMemberType(profile.positions, profile.groupName) }, actorUserId)
  await getDatabase().update(memberApplications).set({ status: 'approved', approvedMemberId: member!.id, reviewNote: note, reviewedAt: new Date(), reviewedByUserId: actorUserId, updatedAt: new Date() }).where(eq(memberApplications.id, id))
  return { status: 'approved', member }
}
