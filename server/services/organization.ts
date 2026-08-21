import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type {
  CmsOrganizationResponse,
  OrganizationStructure,
  PublicOrganizationResponse
} from '../../shared/types/organization'
import {
  ORGANIZATION_NODE_KINDS
} from '../../shared/types/organization'
import { getDatabase } from '../db/client'
import { auditLogs, organizationConfigs } from '../db/schema'

const nodeSchema = z.object({
  id: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
  parentId: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/).nullable(),
  kind: z.enum(ORGANIZATION_NODE_KINDS),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300),
  sortOrder: z.number().int().min(0).max(1000)
}).strict()

const relationSchema = z.object({
  id: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
  fromNodeId: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
  toNodeId: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(180)
}).strict()

const structureSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  responsibilityNote: z.string().trim().min(1).max(120),
  rootNodeId: z.string().trim().min(2).max(64).regex(/^[a-z][a-z0-9-]*$/),
  nodes: z.array(nodeSchema).min(1).max(100),
  relations: z.array(relationSchema).max(50)
}).strict()

export const validateOrganizationStructure = (input: unknown): OrganizationStructure => {
  const parsed = structureSchema.parse(input)
  const nodeIds = new Set<string>()
  for (const node of parsed.nodes) {
    if (nodeIds.has(node.id)) throw new Error('ORGANIZATION_NODE_ID_DUPLICATE')
    nodeIds.add(node.id)
  }

  const roots = parsed.nodes.filter(node => node.parentId === null)
  if (roots.length !== 1 || roots[0]!.id !== parsed.rootNodeId) {
    throw new Error('ORGANIZATION_ROOT_INVALID')
  }
  if (roots[0]!.kind !== 'organization') throw new Error('ORGANIZATION_ROOT_KIND_INVALID')

  for (const node of parsed.nodes) {
    if (node.parentId !== null && (!nodeIds.has(node.parentId) || node.parentId === node.id)) {
      throw new Error('ORGANIZATION_PARENT_INVALID')
    }
  }

  const nodeMap = new Map(parsed.nodes.map(node => [node.id, node]))
  const allowedParentKind = {
    institution: 'organization',
    responsibility: 'institution',
    division: 'institution',
    group: 'division',
    role: 'group'
  } as const
  for (const node of parsed.nodes) {
    if (node.kind === 'organization') {
      if (node.id !== parsed.rootNodeId) throw new Error('ORGANIZATION_NODE_KIND_INVALID')
      continue
    }
    const parent = node.parentId ? nodeMap.get(node.parentId) : undefined
    if (!parent || parent.kind !== allowedParentKind[node.kind]) {
      throw new Error('ORGANIZATION_NODE_KIND_INVALID')
    }
  }
  const institutions = parsed.nodes.filter(node => node.kind === 'institution')
  if (!institutions.length) throw new Error('ORGANIZATION_INSTITUTION_REQUIRED')
  for (const institution of institutions) {
    if (parsed.nodes.filter(node =>
      node.parentId === institution.id && node.kind === 'responsibility'
    ).length > 1) throw new Error('ORGANIZATION_RESPONSIBILITY_DUPLICATE')
  }

  const children = new Map<string, string[]>()
  for (const node of parsed.nodes) {
    if (!node.parentId) continue
    children.set(node.parentId, [...(children.get(node.parentId) || []), node.id])
  }
  const visited = new Set<string>()
  const stack = [parsed.rootNodeId]
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id)) throw new Error('ORGANIZATION_CYCLE_INVALID')
    visited.add(id)
    stack.push(...(children.get(id) || []))
  }
  if (visited.size !== parsed.nodes.length) throw new Error('ORGANIZATION_TREE_DISCONNECTED')

  const relationIds = new Set<string>()
  for (const relation of parsed.relations) {
    if (relationIds.has(relation.id)) throw new Error('ORGANIZATION_RELATION_ID_DUPLICATE')
    relationIds.add(relation.id)
    if (
      relation.fromNodeId === relation.toNodeId
      || !nodeIds.has(relation.fromNodeId)
      || !nodeIds.has(relation.toNodeId)
    ) throw new Error('ORGANIZATION_RELATION_TARGET_INVALID')
  }

  return parsed
}

const getCurrentConfig = async () => {
  const db = getDatabase()
  const row = (await db.select().from(organizationConfigs).where(eq(organizationConfigs.id, 'current')))[0]
  if (!row) throw new Error('ORGANIZATION_CONFIG_MISSING')
  return row
}

const isSameStructure = (left: OrganizationStructure, right: OrganizationStructure) =>
  JSON.stringify(left) === JSON.stringify(right)

export const getPublicOrganization = async (): Promise<PublicOrganizationResponse> => {
  const row = await getCurrentConfig()
  return {
    structure: validateOrganizationStructure(row.publishedStructure),
    publishedAt: row.publishedAt.toISOString(),
    publishedVersion: row.publishedVersion
  }
}

const toCmsResponse = (row: typeof organizationConfigs.$inferSelect): CmsOrganizationResponse => ({
  structure: validateOrganizationStructure(row.publishedStructure),
  draft: validateOrganizationStructure(row.draftStructure),
  version: row.version,
  publishedVersion: row.publishedVersion,
  publishedAt: row.publishedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  hasUnpublishedChanges: !isSameStructure(row.draftStructure, row.publishedStructure)
})

export const getCmsOrganization = async () => toCmsResponse(await getCurrentConfig())

export const saveOrganizationDraft = async (
  structure: unknown,
  expectedVersion: number,
  actorUserId: string
) => {
  const draft = validateOrganizationStructure(structure)
  const db = getDatabase()
  const rows = await db.transaction(async (tx) => {
    const updated = await tx.update(organizationConfigs).set({
      draftStructure: draft,
      version: expectedVersion + 1,
      updatedByUserId: actorUserId,
      updatedAt: new Date()
    }).where(and(
      eq(organizationConfigs.id, 'current'),
      eq(organizationConfigs.version, expectedVersion)
    )).returning()
    if (!updated[0]) return []
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'organization.draft.save',
      targetType: 'organization',
      targetId: 'current',
      metadata: { version: updated[0].version, nodeCount: draft.nodes.length, relationCount: draft.relations.length }
    })
    return updated
  })
  if (!rows[0]) throw new Error('ORGANIZATION_VERSION_CONFLICT')
  return toCmsResponse(rows[0])
}

export const publishOrganization = async (expectedVersion: number, actorUserId: string) => {
  const db = getDatabase()
  const now = new Date()
  const rows = await db.transaction(async (tx) => {
    const current = (await tx.select().from(organizationConfigs).where(and(
      eq(organizationConfigs.id, 'current'),
      eq(organizationConfigs.version, expectedVersion)
    )))[0]
    if (!current) return []
    const draft = validateOrganizationStructure(current.draftStructure)
    const updated = await tx.update(organizationConfigs).set({
      publishedStructure: draft,
      publishedVersion: expectedVersion,
      publishedAt: now,
      updatedByUserId: actorUserId,
      updatedAt: now
    }).where(and(
      eq(organizationConfigs.id, 'current'),
      eq(organizationConfigs.version, expectedVersion)
    )).returning()
    if (!updated[0]) return []
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'organization.publish',
      targetType: 'organization',
      targetId: 'current',
      metadata: { version: expectedVersion, nodeCount: draft.nodes.length, relationCount: draft.relations.length }
    })
    return updated
  })
  if (!rows[0]) throw new Error('ORGANIZATION_VERSION_CONFLICT')
  return toCmsResponse(rows[0])
}
