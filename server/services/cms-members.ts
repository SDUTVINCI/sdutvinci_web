import { asc, eq } from 'drizzle-orm'
import type { CmsMember, CmsMemberInput } from '../../shared/types/cms-members'
import { getDatabase } from '../db/client'
import { auditLogs, members, userMembers, users } from '../db/schema'
import {
  createContentFile,
  listMarkdownFiles,
  readContentFile,
  writeContentFileAtomically
} from '../utils/cms-content-path'
import {
  insertStableMemberId,
  parseCmsMarkdown,
  writeCmsMarkdown
} from '../utils/cms-frontmatter'
import { allocateMemberKey, memberKeyFromName } from '../utils/member-key'

const memberKeyPattern = /^[a-z][a-z0-9]{2,31}$/

interface ScannedMember {
  memberKey: string
  name: string
  avatarUrl: string | null
  sourcePath: string
  metadata: Record<string, unknown>
}

const scanMembers = async (writeMissingIds: boolean) => {
  const paths = await listMarkdownFiles('members')
  const records = await Promise.all(paths.map(async (sourcePath) => {
    const { source } = await readContentFile('members', sourcePath)
    const parsed = parseCmsMarkdown(source)
    const name = String(parsed.frontmatter.name || '').trim()
    const existingId = typeof parsed.frontmatter.id === 'string'
      ? parsed.frontmatter.id.trim().toLowerCase()
      : ''
    if (!name) throw new Error(`${sourcePath} 缺少成员姓名`)
    if (existingId && !memberKeyPattern.test(existingId)) {
      throw new Error(`${sourcePath} 的成员 ID 不合法`)
    }
    return { sourcePath, source, parsed, name, existingId }
  }))

  const used = new Set<string>()
  for (const record of records) {
    if (!record.existingId) continue
    if (used.has(record.existingId)) {
      throw new Error(`成员 ID 重复：${record.existingId}`)
    }
    used.add(record.existingId)
  }

  const scanned: ScannedMember[] = []
  for (const record of records) {
    const memberKey = record.existingId
      || allocateMemberKey(memberKeyFromName(record.name), used)
    if (!record.existingId && writeMissingIds) {
      await writeContentFileAtomically(
        'members',
        record.sourcePath,
        insertStableMemberId(record.source, memberKey)
      )
    }
    const metadata: Record<string, unknown> = {
      ...record.parsed.frontmatter,
      id: memberKey
    }
    scanned.push({
      memberKey,
      name: record.name,
      avatarUrl: typeof metadata.image === 'string' ? metadata.image : null,
      sourcePath: record.sourcePath,
      metadata
    })
  }
  return scanned
}

export const synchronizeCmsMembers = async (writeMissingIds = false) => {
  const db = getDatabase()
  const scanned = await scanMembers(writeMissingIds)

  await db.transaction(async (tx) => {
    for (const item of scanned) {
      await tx.insert(members).values(item).onConflictDoUpdate({
        target: members.memberKey,
        set: {
          name: item.name,
          avatarUrl: item.avatarUrl,
          sourcePath: item.sourcePath,
          metadata: item.metadata,
          updatedAt: new Date()
        }
      })
    }

    const linkCandidates = await tx
      .select({ userId: users.id, memberId: members.id })
      .from(users)
      .innerJoin(members, eq(users.account, members.memberKey))
    if (linkCandidates.length) {
      await tx.insert(userMembers).values(linkCandidates).onConflictDoNothing()
    }
  })

  return scanned.length
}

export const listCmsMembers = async (): Promise<CmsMember[]> => {
  await synchronizeCmsMembers(false)
  const rows = await getDatabase()
    .select({
      id: members.id,
      memberKey: members.memberKey,
      name: members.name,
      avatarUrl: members.avatarUrl,
      sourcePath: members.sourcePath,
      metadata: members.metadata,
      linkedAccount: users.account,
      createdAt: members.createdAt,
      updatedAt: members.updatedAt
    })
    .from(members)
    .leftJoin(userMembers, eq(members.id, userMembers.memberId))
    .leftJoin(users, eq(userMembers.userId, users.id))
    .orderBy(asc(members.memberKey))

  return rows.map(row => ({
    ...row,
    sourcePath: row.sourcePath || '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export const getCmsMember = async (id: string) =>
  (await listCmsMembers()).find(member => member.id === id) ?? null

export const createCmsMember = async (
  input: CmsMemberInput & { memberKey: string },
  actorUserId: string
) => {
  const db = getDatabase()
  const memberKey = input.memberKey.trim().toLowerCase()
  const sourcePath = `cms/${memberKey}.md`
  const metadata = {
    ...(input.metadata || {}),
    name: input.name.trim(),
    id: memberKey,
    image: input.avatarUrl || null
  }
  await createContentFile('members', sourcePath, writeCmsMarkdown(metadata, '\n'))

  const [created] = await db.insert(members).values({
    memberKey,
    name: input.name.trim(),
    avatarUrl: input.avatarUrl || null,
    sourcePath,
    metadata
  }).returning({ id: members.id })

  const [matchingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.account, memberKey))
    .limit(1)
  if (matchingUser) {
    await db.insert(userMembers).values({
      userId: matchingUser.id,
      memberId: created!.id
    }).onConflictDoNothing()
  }

  await db.insert(auditLogs).values({
    actorUserId,
    action: 'member.create',
    targetType: 'member',
    targetId: created!.id,
    metadata: { memberKey, sourcePath }
  })
  return getCmsMember(created!.id)
}

export const updateCmsMember = async (
  id: string,
  input: Omit<CmsMemberInput, 'memberKey' | 'directory'>,
  actorUserId: string
) => {
  const db = getDatabase()
  const [current] = await db.select().from(members).where(eq(members.id, id)).limit(1)
  if (!current?.sourcePath) return null

  const { source } = await readContentFile('members', current.sourcePath)
  const parsed = parseCmsMarkdown(source)
  const metadata = {
    ...parsed.frontmatter,
    ...(input.metadata || {}),
    id: current.memberKey,
    name: input.name.trim(),
    image: input.avatarUrl || null
  }
  await writeContentFileAtomically(
    'members',
    current.sourcePath,
    writeCmsMarkdown(metadata, parsed.body)
  )
  await db.transaction(async (tx) => {
    await tx.update(members).set({
      name: input.name.trim(),
      avatarUrl: input.avatarUrl || null,
      metadata,
      updatedAt: new Date()
    }).where(eq(members.id, id))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'member.update',
      targetType: 'member',
      targetId: id,
      metadata: { memberKey: current.memberKey }
    })
  })
  return getCmsMember(id)
}
