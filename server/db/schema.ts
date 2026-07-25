import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}

export const userStatusEnum = pgEnum('user_status', ['active', 'disabled'])

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  ...timestamps
}, table => [
  uniqueIndex('roles_code_unique').on(table.code)
])

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  account: varchar('account', { length: 32 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  status: userStatusEnum('status').default('active').notNull(),
  ...timestamps
}, table => [
  check('users_account_format_check', sql`${table.account} ~ '^[a-z][a-z0-9]{2,31}$'`),
  uniqueIndex('users_account_unique').on(table.account),
  index('users_status_index').on(table.status)
])

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  primaryKey({ columns: [table.userId, table.roleId], name: 'user_roles_primary_key' }),
  index('user_roles_role_id_index').on(table.roleId)
])

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberKey: varchar('member_key', { length: 100 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  avatarUrl: text('avatar_url'),
  sourcePath: text('source_path'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, table => [
  uniqueIndex('members_member_key_unique').on(table.memberKey),
  uniqueIndex('members_source_path_unique').on(table.sourcePath)
])

export const articles = pgTable('articles', {
  id: uuid('id').defaultRandom().primaryKey(),
  collection: varchar('collection', { length: 32 }).notNull(),
  relativePath: text('relative_path').notNull(),
  publicPath: text('public_path').notNull(),
  directory: text('directory').notNull(),
  title: text('title').notNull(),
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().default({}).notNull(),
  searchText: text('search_text').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  isPresent: varchar('is_present', { length: 5 }).default('true').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, table => [
  check('articles_collection_check', sql`${table.collection} in ('news', 'wiki')`),
  check('articles_is_present_check', sql`${table.isPresent} in ('true', 'false')`),
  uniqueIndex('articles_source_unique').on(table.collection, table.relativePath),
  index('articles_collection_index').on(table.collection),
  index('articles_directory_index').on(table.directory),
  index('articles_present_index').on(table.isPresent),
  index('articles_deleted_at_index').on(table.deletedAt)
])

export const drafts = pgTable('drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id')
    .references(() => articles.id, { onDelete: 'restrict' }),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  collection: varchar('collection', { length: 32 }).notNull(),
  title: text('title').notNull(),
  description: text('description').default('').notNull(),
  body: text('body').default('').notNull(),
  preservedFrontmatter: jsonb('preserved_frontmatter')
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  baseContentHash: varchar('base_content_hash', { length: 64 }),
  status: varchar('status', { length: 32 }).default('draft').notNull(),
  version: integer('version').default(1).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  lastSavedAt: timestamp('last_saved_at', { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, table => [
  check('drafts_collection_check', sql`${table.collection} in ('news', 'wiki')`),
  check(
    'drafts_status_check',
    sql`${table.status} in ('draft', 'pending_review', 'rejected', 'approved', 'published', 'withdrawn')`
  ),
  check('drafts_version_check', sql`${table.version} >= 1`),
  uniqueIndex('drafts_article_owner_unique')
    .on(table.articleId, table.ownerUserId)
    .where(sql`${table.deletedAt} is null`),
  index('drafts_owner_user_id_index').on(table.ownerUserId),
  index('drafts_article_id_index').on(table.articleId),
  index('drafts_status_index').on(table.status),
  index('drafts_deleted_at_index').on(table.deletedAt),
  index('drafts_updated_at_index').on(table.updatedAt)
])

export const draftAuthors = pgTable('draft_authors', {
  draftId: uuid('draft_id')
    .notNull()
    .references(() => drafts.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  primaryKey({ columns: [table.draftId, table.memberId], name: 'draft_authors_primary_key' }),
  uniqueIndex('draft_authors_position_unique').on(table.draftId, table.position),
  index('draft_authors_member_id_index').on(table.memberId)
])

export const reviewEvents = pgTable('review_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  draftId: uuid('draft_id')
    .notNull()
    .references(() => drafts.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 32 }).notNull(),
  fromStatus: varchar('from_status', { length: 32 }).notNull(),
  toStatus: varchar('to_status', { length: 32 }).notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check(
    'review_events_action_check',
    sql`${table.action} in ('submitted', 'withdrawn', 'rejected', 'approved', 'reopened', 'resynced')`
  ),
  index('review_events_draft_id_index').on(table.draftId),
  index('review_events_actor_user_id_index').on(table.actorUserId),
  index('review_events_created_at_index').on(table.createdAt)
])

export const publishRecords = pgTable('publish_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  draftId: uuid('draft_id')
    .references(() => drafts.id, { onDelete: 'set null' }),
  articleId: uuid('article_id')
    .references(() => articles.id, { onDelete: 'set null' }),
  operatorUserId: uuid('operator_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  reviewerUserId: uuid('reviewer_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  operation: varchar('operation', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('pending').notNull(),
  commitHash: varchar('commit_hash', { length: 64 }),
  articlePath: text('article_path').notNull(),
  message: text('message').notNull(),
  failureReason: text('failure_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check('publish_records_operation_check', sql`${table.operation} in ('publish', 'restore')`),
  check('publish_records_status_check', sql`${table.status} in ('pending', 'succeeded', 'failed')`),
  index('publish_records_draft_id_index').on(table.draftId),
  index('publish_records_article_id_index').on(table.articleId),
  index('publish_records_operator_user_id_index').on(table.operatorUserId),
  index('publish_records_created_at_index').on(table.createdAt)
])

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  draftId: uuid('draft_id')
    .notNull()
    .references(() => drafts.id, { onDelete: 'restrict' }),
  uploaderUserId: uuid('uploader_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  objectKey: text('object_key').notNull(),
  publicUrl: text('public_url').notNull(),
  originalFilename: text('original_filename').notNull(),
  originalMimeType: varchar('original_mime_type', { length: 100 }).notNull(),
  originalByteSize: integer('original_byte_size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check('media_assets_original_byte_size_check', sql`${table.originalByteSize} > 0`),
  check('media_assets_width_check', sql`${table.width} > 0`),
  check('media_assets_height_check', sql`${table.height} > 0`),
  check('media_assets_byte_size_check', sql`${table.byteSize} > 0`),
  uniqueIndex('media_assets_object_key_unique').on(table.objectKey),
  index('media_assets_draft_id_index').on(table.draftId),
  index('media_assets_uploader_user_id_index').on(table.uploaderUserId),
  index('media_assets_created_at_index').on(table.createdAt)
])

export const articleDeletionEvents = pgTable('article_deletion_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id, { onDelete: 'restrict' }),
  actorUserId: uuid('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  operation: varchar('operation', { length: 16 }).notNull(),
  articlePath: text('article_path').notNull(),
  sourceCommitHash: varchar('source_commit_hash', { length: 64 }).notNull(),
  commitHash: varchar('commit_hash', { length: 64 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check(
    'article_deletion_events_operation_check',
    sql`${table.operation} in ('delete', 'restore')`
  ),
  index('article_deletion_events_article_id_index').on(table.articleId),
  index('article_deletion_events_actor_user_id_index').on(table.actorUserId),
  index('article_deletion_events_created_at_index').on(table.createdAt)
])

export const editLocks = pgTable('edit_locks', {
  id: uuid('id').defaultRandom().primaryKey(),
  targetType: varchar('target_type', { length: 32 }).notNull(),
  targetId: uuid('target_id').notNull(),
  holderUserId: uuid('holder_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  leaseId: uuid('lease_id').defaultRandom().notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).defaultNow().notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
}, table => [
  check('edit_locks_target_type_check', sql`${table.targetType} in ('article', 'draft')`),
  uniqueIndex('edit_locks_target_unique').on(table.targetType, table.targetId),
  uniqueIndex('edit_locks_lease_id_unique').on(table.leaseId),
  index('edit_locks_holder_user_id_index').on(table.holderUserId),
  index('edit_locks_expires_at_index').on(table.expiresAt)
])

export const userMembers = pgTable('user_members', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('user_members_member_id_unique').on(table.memberId)
])

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ipHash: varchar('ip_hash', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  index('sessions_user_id_index').on(table.userId),
  index('sessions_expires_at_index').on(table.expiresAt)
])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: varchar('target_id', { length: 128 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  index('audit_logs_actor_user_id_index').on(table.actorUserId),
  index('audit_logs_action_index').on(table.action),
  index('audit_logs_created_at_index').on(table.createdAt)
])

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Role = typeof roles.$inferSelect
export type Session = typeof sessions.$inferSelect
export type Member = typeof members.$inferSelect
export type Article = typeof articles.$inferSelect
export type Draft = typeof drafts.$inferSelect
export type ReviewEvent = typeof reviewEvents.$inferSelect
export type PublishRecord = typeof publishRecords.$inferSelect
export type MediaAsset = typeof mediaAssets.$inferSelect
export type ArticleDeletionEvent = typeof articleDeletionEvents.$inferSelect
export type EditLock = typeof editLocks.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
