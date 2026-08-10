import {
  type AnyPgColumn,
  boolean,
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
  role: text('role'),
  memberType: text('member_type'),
  groupName: varchar('group_name', { length: 64 }),
  positions: jsonb('positions').$type<string[]>().default([]).notNull(),
  seasons: jsonb('seasons').$type<string[]>().default([]).notNull(),
  advisorSeasons: jsonb('advisor_seasons').$type<string[]>().default([]).notNull(),
  grade: varchar('grade', { length: 32 }),
  affiliation: text('affiliation'),
  links: jsonb('links').$type<Record<string, string | null>>().default({}).notNull(),
  body: text('body').default('').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  version: integer('version').default(1).notNull(),
  currentRevisionId: uuid('current_revision_id')
    .references((): AnyPgColumn => memberRevisions.id, { onDelete: 'restrict' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps
}, table => [
  check('members_version_check', sql`${table.version} >= 1`),
  check('members_sort_order_check', sql`${table.sortOrder} >= 0`),
  uniqueIndex('members_member_key_unique').on(table.memberKey),
  uniqueIndex('members_source_path_unique').on(table.sourcePath),
  index('members_deleted_at_index').on(table.deletedAt),
  index('members_sort_index').on(table.sortOrder, table.memberKey)
])

export const memberRevisions = pgTable('member_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  revisionNumber: integer('revision_number').notNull(),
  memberKey: varchar('member_key', { length: 100 }).notNull(),
  sourcePath: text('source_path').notNull(),
  profile: jsonb('profile').$type<Record<string, unknown>>().default({}).notNull(),
  markdownSource: text('markdown_source').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  sourceKind: varchar('source_kind', { length: 32 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  restoredFromRevisionId: uuid('restored_from_revision_id')
    .references((): AnyPgColumn => memberRevisions.id, { onDelete: 'restrict' }),
  sourceProposalId: uuid('source_proposal_id')
    .references((): AnyPgColumn => memberProposals.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check('member_revisions_number_check', sql`${table.revisionNumber} >= 1`),
  check(
    'member_revisions_hash_check',
    sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
  ),
  check(
    'member_revisions_source_kind_check',
    sql`${table.sourceKind} in ('backfill', 'cms_create', 'cms_update', 'proposal_apply', 'restore', 'delete')`
  ),
  uniqueIndex('member_revisions_member_number_unique')
    .on(table.memberId, table.revisionNumber),
  uniqueIndex('member_revisions_source_proposal_unique').on(table.sourceProposalId),
  index('member_revisions_member_created_index').on(table.memberId, table.createdAt)
])

export const memberProposals = pgTable('member_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  baseRevisionId: uuid('base_revision_id')
    .notNull()
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  currentRevisionId: uuid('current_revision_id')
    .notNull()
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).default('pending').notNull(),
  proposedProfile: jsonb('proposed_profile').$type<Record<string, unknown>>(),
  fieldChanges: jsonb('field_changes').$type<Record<string, unknown>>().default({}).notNull(),
  sourceImportItemId: uuid('source_import_item_id')
    .references((): AnyPgColumn => contentPrImportItems.id, { onDelete: 'restrict' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  appliedByUserId: uuid('applied_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  appliedRevisionId: uuid('applied_revision_id')
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}, table => [
  check('member_proposals_action_check', sql`${table.action} in ('update', 'delete')`),
  check(
    'member_proposals_status_check',
    sql`${table.status} in ('pending', 'conflicted', 'applied', 'rejected')`
  ),
  uniqueIndex('member_proposals_import_item_unique').on(table.sourceImportItemId),
  index('member_proposals_member_status_index').on(table.memberId, table.status, table.createdAt)
])

export const memberCohorts = pgTable('member_cohorts', {
  id: uuid('id').defaultRandom().primaryKey(),
  gradeYear: integer('grade_year').notNull(),
  season: varchar('season', { length: 16 }).notNull(),
  groups: jsonb('groups').$type<string[]>().default([]).notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps
}, table => [
  check('member_cohorts_grade_year_check', sql`${table.gradeYear} between 2000 and 2200`),
  uniqueIndex('member_cohorts_grade_year_unique').on(table.gradeYear),
  uniqueIndex('member_cohorts_season_unique').on(table.season),
  index('member_cohorts_active_index').on(table.active, table.gradeYear)
])

export const memberApplications = pgTable('member_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  accessTokenHash: varchar('access_token_hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).default('editing').notNull(),
  profile: jsonb('profile').$type<Record<string, unknown>>().default({}).notNull(),
  avatarObjectKey: text('avatar_object_key'),
  avatarPublicUrl: text('avatar_public_url'),
  avatarByteSize: integer('avatar_byte_size'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedByUserId: uuid('reviewed_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  reviewNote: text('review_note'),
  approvedMemberId: uuid('approved_member_id')
    .references(() => members.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps
}, table => [
  check('member_applications_status_check', sql`${table.status} in ('editing', 'submitted', 'approved', 'rejected', 'abandoned')`),
  check('member_applications_avatar_byte_size_check', sql`${table.avatarByteSize} is null or ${table.avatarByteSize} > 0`),
  uniqueIndex('member_applications_access_token_hash_unique').on(table.accessTokenHash),
  uniqueIndex('member_applications_avatar_object_key_unique').on(table.avatarObjectKey),
  index('member_applications_status_created_index').on(table.status, table.createdAt),
  index('member_applications_expires_at_index').on(table.expiresAt)
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
  currentRevisionId: uuid('current_revision_id')
    .references((): AnyPgColumn => articleRevisions.id, { onDelete: 'restrict' }),
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
  baseRevisionId: uuid('base_revision_id')
    .references((): AnyPgColumn => articleRevisions.id, { onDelete: 'restrict' }),
  proposedAction: varchar('proposed_action', { length: 16 }).default('edit').notNull(),
  proposedRelativePath: text('proposed_relative_path'),
  proposedArticleId: uuid('proposed_article_id'),
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
  check(
    'drafts_proposed_action_check',
    sql`${table.proposedAction} in ('edit', 'move', 'delete')`
  ),
  check(
    'drafts_proposed_path_check',
    sql`(${table.proposedAction} = 'move' and ${table.proposedRelativePath} is not null) or (${table.proposedAction} <> 'move')`
  ),
  uniqueIndex('drafts_proposed_article_id_unique')
    .on(table.proposedArticleId)
    .where(sql`${table.proposedArticleId} is not null`),
  uniqueIndex('drafts_article_owner_unique')
    .on(table.articleId, table.ownerUserId)
    .where(sql`${table.deletedAt} is null`),
  index('drafts_owner_user_id_index').on(table.ownerUserId),
  index('drafts_article_id_index').on(table.articleId),
  index('drafts_status_index').on(table.status),
  index('drafts_deleted_at_index').on(table.deletedAt),
  index('drafts_updated_at_index').on(table.updatedAt)
])

export const articleRevisions = pgTable('article_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id, { onDelete: 'restrict' }),
  revisionNumber: integer('revision_number').notNull(),
  markdownSource: text('markdown_source').notNull(),
  body: text('body').notNull(),
  frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().default({}).notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  sourceKind: varchar('source_kind', { length: 32 }).default('backfill').notNull(),
  sourceDraftId: uuid('source_draft_id')
    .references(() => drafts.id, { onDelete: 'set null' }),
  publishedByUserId: uuid('published_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  reviewedByUserId: uuid('reviewed_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  restoredFromRevisionId: uuid('restored_from_revision_id')
    .references((): AnyPgColumn => articleRevisions.id, { onDelete: 'restrict' }),
  sourceOperationId: uuid('source_operation_id')
    .references((): AnyPgColumn => publishRecords.id, { onDelete: 'restrict' }),
  gitCommitHash: varchar('git_commit_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check('article_revisions_number_check', sql`${table.revisionNumber} >= 1`),
  check(
    'article_revisions_content_hash_check',
    sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
  ),
  check(
    'article_revisions_source_kind_check',
    sql`${table.sourceKind} in ('backfill', 'publish', 'restore', 'member_publish')`
  ),
  uniqueIndex('article_revisions_article_number_unique')
    .on(table.articleId, table.revisionNumber),
  uniqueIndex('article_revisions_source_operation_unique')
    .on(table.sourceOperationId),
  uniqueIndex('article_revisions_article_git_commit_unique')
    .on(table.articleId, table.gitCommitHash),
  index('article_revisions_article_created_at_index')
    .on(table.articleId, table.createdAt),
  index('article_revisions_content_hash_index').on(table.contentHash),
  index('article_revisions_source_draft_id_index').on(table.sourceDraftId)
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
  sourceCommitHash: varchar('source_commit_hash', { length: 64 }),
  commitHash: varchar('commit_hash', { length: 64 }),
  sourceRevisionId: uuid('source_revision_id')
    .references(() => articleRevisions.id, { onDelete: 'restrict' }),
  resultRevisionId: uuid('result_revision_id')
    .references(() => articleRevisions.id, { onDelete: 'restrict' }),
  exportJobId: uuid('export_job_id')
    .references((): AnyPgColumn => contentExportJobs.id, { onDelete: 'restrict' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check(
    'article_deletion_events_operation_check',
    sql`${table.operation} in ('delete', 'restore')`
  ),
  index('article_deletion_events_article_id_index').on(table.articleId),
  index('article_deletion_events_actor_user_id_index').on(table.actorUserId),
  index('article_deletion_events_source_revision_id_index').on(table.sourceRevisionId),
  index('article_deletion_events_result_revision_id_index').on(table.resultRevisionId),
  uniqueIndex('article_deletion_events_export_job_unique').on(table.exportJobId),
  index('article_deletion_events_created_at_index').on(table.createdAt)
])

export const contentExportRuns = pgTable('content_export_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  trigger: varchar('trigger', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('processing').notNull(),
  workerId: varchar('worker_id', { length: 128 }),
  baseCommitHash: varchar('base_commit_hash', { length: 64 }),
  localCommitHash: varchar('local_commit_hash', { length: 64 }),
  resultCommitHash: varchar('result_commit_hash', { length: 64 }),
  jobCount: integer('job_count').default(0).notNull(),
  fileWriteCount: integer('file_write_count').default(0).notNull(),
  fileDeleteCount: integer('file_delete_count').default(0).notNull(),
  noopCount: integer('noop_count').default(0).notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  errorSummary: text('error_summary'),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check(
    'content_export_runs_trigger_check',
    sql`${table.trigger} in ('worker', 'manual_retry', 'takeover')`
  ),
  check(
    'content_export_runs_status_check',
    sql`${table.status} in ('processing', 'succeeded', 'failed')`
  ),
  check('content_export_runs_job_count_check', sql`${table.jobCount} >= 0`),
  check('content_export_runs_file_write_count_check', sql`${table.fileWriteCount} >= 0`),
  check('content_export_runs_file_delete_count_check', sql`${table.fileDeleteCount} >= 0`),
  check('content_export_runs_noop_count_check', sql`${table.noopCount} >= 0`),
  index('content_export_runs_status_started_index').on(table.status, table.startedAt),
  index('content_export_runs_completed_at_index').on(table.completedAt)
])

export const contentExportJobs = pgTable('content_export_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  targetType: varchar('target_type', { length: 32 }).notNull(),
  targetId: uuid('target_id').notNull(),
  revisionId: uuid('revision_id')
    .references(() => articleRevisions.id, { onDelete: 'restrict' }),
  memberRevisionId: uuid('member_revision_id')
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  operation: varchar('operation', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('pending').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastError: text('last_error'),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  targetPath: text('target_path'),
  previousPath: text('previous_path'),
  expectedSha256: varchar('expected_sha256', { length: 64 }),
  leaseOwner: varchar('lease_owner', { length: 128 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  latestRunId: uuid('latest_run_id')
    .references(() => contentExportRuns.id, { onDelete: 'set null' }),
  exportedPath: text('exported_path'),
  exportedSha256: varchar('exported_sha256', { length: 64 }),
  exportedCommitHash: varchar('exported_commit_hash', { length: 64 }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ...timestamps
}, table => [
  check(
    'content_export_jobs_target_type_check',
    sql`${table.targetType} in ('article', 'member')`
  ),
  check(
    'content_export_jobs_operation_check',
    sql`${table.operation} in ('create', 'update', 'move', 'delete', 'member_update')`
  ),
  check(
    'content_export_jobs_status_check',
    sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`
  ),
  check('content_export_jobs_attempt_count_check', sql`${table.attemptCount} >= 0`),
  check(
    'content_export_jobs_expected_sha256_check',
    sql`${table.expectedSha256} is null or ${table.expectedSha256} ~ '^[0-9a-f]{64}$'`
  ),
  check(
    'content_export_jobs_exported_sha256_check',
    sql`${table.exportedSha256} is null or ${table.exportedSha256} ~ '^[0-9a-f]{64}$'`
  ),
  uniqueIndex('content_export_jobs_idempotency_key_unique').on(table.idempotencyKey),
  uniqueIndex('content_export_jobs_revision_operation_unique')
    .on(table.revisionId, table.operation)
    .where(sql`${table.revisionId} is not null`),
  uniqueIndex('content_export_jobs_member_revision_operation_unique')
    .on(table.memberRevisionId, table.operation)
    .where(sql`${table.memberRevisionId} is not null`),
  index('content_export_jobs_pending_index')
    .on(table.status, table.nextAttemptAt, table.createdAt),
  index('content_export_jobs_target_index')
    .on(table.targetType, table.targetId, table.createdAt),
  index('content_export_jobs_revision_id_index').on(table.revisionId),
  index('content_export_jobs_member_revision_id_index').on(table.memberRevisionId),
  index('content_export_jobs_lease_index').on(table.status, table.leaseExpiresAt),
  index('content_export_jobs_latest_run_id_index').on(table.latestRunId)
])

export const contentReconciliationRuns = pgTable('content_reconciliation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  trigger: varchar('trigger', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('processing').notNull(),
  baseCommitHash: varchar('base_commit_hash', { length: 64 }),
  resultCommitHash: varchar('result_commit_hash', { length: 64 }),
  reportSha256: varchar('report_sha256', { length: 64 }),
  reportPath: text('report_path'),
  addedCount: integer('added_count').default(0).notNull(),
  missingCount: integer('missing_count').default(0).notNull(),
  modifiedCount: integer('modified_count').default(0).notNull(),
  extraCount: integer('extra_count').default(0).notNull(),
  metadataMismatchCount: integer('metadata_mismatch_count').default(0).notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  errorSummary: text('error_summary'),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check(
    'content_reconciliation_runs_trigger_check',
    sql`${table.trigger} in ('schedule', 'manual')`
  ),
  check(
    'content_reconciliation_runs_status_check',
    sql`${table.status} in ('processing', 'succeeded', 'failed', 'busy')`
  ),
  check('content_reconciliation_runs_added_check', sql`${table.addedCount} >= 0`),
  check('content_reconciliation_runs_missing_check', sql`${table.missingCount} >= 0`),
  check('content_reconciliation_runs_modified_check', sql`${table.modifiedCount} >= 0`),
  check('content_reconciliation_runs_extra_check', sql`${table.extraCount} >= 0`),
  check(
    'content_reconciliation_runs_metadata_check',
    sql`${table.metadataMismatchCount} >= 0`
  ),
  index('content_reconciliation_runs_started_index').on(table.startedAt),
  index('content_reconciliation_runs_status_index').on(table.status, table.completedAt)
])

export const contentReconciliationRequests = pgTable('content_reconciliation_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestedByUserId: uuid('requested_by_user_id').notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).default('pending').notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  errorSummary: text('error_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check(
    'content_reconciliation_requests_status_check',
    sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed', 'busy')`
  ),
  index('content_reconciliation_requests_status_index').on(table.status, table.createdAt),
  index('content_reconciliation_requests_user_index').on(table.requestedByUserId, table.createdAt)
])

export const contentImportRuns = pgTable('content_import_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  mode: varchar('mode', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).default('dry_run').notNull(),
  sourceCommitHash: varchar('source_commit_hash', { length: 64 }),
  snapshotSha256: varchar('snapshot_sha256', { length: 64 }).notNull(),
  confirmationHash: varchar('confirmation_hash', { length: 64 }),
  actorLabel: varchar('actor_label', { length: 128 }).notNull(),
  itemCount: integer('item_count').default(0).notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  errorSummary: text('error_summary'),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check(
    'content_import_runs_mode_check',
    sql`${table.mode} in ('empty_database_initialization', 'disaster_recovery')`
  ),
  check(
    'content_import_runs_status_check',
    sql`${table.status} in ('dry_run', 'succeeded', 'failed')`
  ),
  check('content_import_runs_item_count_check', sql`${table.itemCount} >= 0`),
  check(
    'content_import_runs_snapshot_sha_check',
    sql`${table.snapshotSha256} ~ '^[0-9a-f]{64}$'`
  ),
  index('content_import_runs_started_index').on(table.startedAt),
  index('content_import_runs_status_index').on(table.status, table.completedAt)
])

export const contentImportItems = pgTable('content_import_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => contentImportRuns.id, { onDelete: 'cascade' }),
  articleId: uuid('article_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  collection: varchar('collection', { length: 32 }).notNull(),
  relativePath: text('relative_path').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check(
    'content_import_items_collection_check',
    sql`${table.collection} in ('news', 'wiki')`
  ),
  check(
    'content_import_items_status_check',
    sql`${table.status} in ('validated', 'imported', 'failed')`
  ),
  check(
    'content_import_items_sha_check',
    sql`${table.sha256} ~ '^[0-9a-f]{64}$'`
  ),
  uniqueIndex('content_import_items_run_article_unique').on(table.runId, table.articleId),
  index('content_import_items_run_index').on(table.runId)
])

// Normal Pull Request imports deliberately use separate tables from the phase 7
// empty-database/disaster-recovery importer. This makes it impossible for a CMS
// PR request to select a recovery mode or reuse its confirmation token.
export const contentPrImportRuns = pgTable('content_pr_import_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  repositoryId: varchar('repository_id', { length: 200 }).notNull(),
  pullRequestNumber: integer('pull_request_number').notNull(),
  baseCommitHash: varchar('base_commit_hash', { length: 64 }).notNull(),
  headCommitHash: varchar('head_commit_hash', { length: 64 }).notNull(),
  baseSnapshotSha256: varchar('base_snapshot_sha256', { length: 64 }).notNull(),
  actorUserId: uuid('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  prAuthorLabel: varchar('pr_author_label', { length: 128 }),
  status: varchar('status', { length: 32 }).default('dry_run').notNull(),
  itemCount: integer('item_count').default(0).notNull(),
  importableCount: integer('importable_count').default(0).notNull(),
  importedCount: integer('imported_count').default(0).notNull(),
  conflictCount: integer('conflict_count').default(0).notNull(),
  report: jsonb('report').$type<Record<string, unknown>>().default({}).notNull(),
  errorCode: varchar('error_code', { length: 64 }),
  errorSummary: text('error_summary'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check('content_pr_import_runs_pr_check', sql`${table.pullRequestNumber} > 0`),
  check(
    'content_pr_import_runs_base_commit_check',
    sql`${table.baseCommitHash} ~ '^[0-9a-f]{40}$'`
  ),
  check(
    'content_pr_import_runs_head_commit_check',
    sql`${table.headCommitHash} ~ '^[0-9a-f]{40}$'`
  ),
  check(
    'content_pr_import_runs_snapshot_check',
    sql`${table.baseSnapshotSha256} ~ '^[0-9a-f]{64}$'`
  ),
  check(
    'content_pr_import_runs_status_check',
    sql`${table.status} in ('dry_run', 'partially_imported', 'imported', 'failed')`
  ),
  check('content_pr_import_runs_item_count_check', sql`${table.itemCount} >= 0`),
  check('content_pr_import_runs_importable_count_check', sql`${table.importableCount} >= 0`),
  check('content_pr_import_runs_imported_count_check', sql`${table.importedCount} >= 0`),
  check('content_pr_import_runs_conflict_count_check', sql`${table.conflictCount} >= 0`),
  uniqueIndex('content_pr_import_runs_pr_head_unique')
    .on(table.repositoryId, table.pullRequestNumber, table.headCommitHash),
  index('content_pr_import_runs_started_index').on(table.startedAt),
  index('content_pr_import_runs_actor_index').on(table.actorUserId, table.startedAt)
])

export const contentPrImportItems = pgTable('content_pr_import_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => contentPrImportRuns.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  targetType: varchar('target_type', { length: 16 }).default('article').notNull(),
  changeType: varchar('change_type', { length: 16 }).notNull(),
  classification: varchar('classification', { length: 32 }).notNull(),
  importable: boolean('importable').default(false).notNull(),
  oldPath: text('old_path'),
  newPath: text('new_path'),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'restrict' }),
  baseRevisionId: uuid('base_revision_id')
    .references(() => articleRevisions.id, { onDelete: 'restrict' }),
  currentRevisionId: uuid('current_revision_id')
    .references(() => articleRevisions.id, { onDelete: 'restrict' }),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'restrict' }),
  baseMemberRevisionId: uuid('base_member_revision_id')
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  currentMemberRevisionId: uuid('current_member_revision_id')
    .references(() => memberRevisions.id, { onDelete: 'restrict' }),
  proposedArticleId: uuid('proposed_article_id').defaultRandom(),
  baseSource: text('base_source'),
  currentSource: text('current_source'),
  proposedSource: text('proposed_source'),
  mergedSource: text('merged_source'),
  baseSha256: varchar('base_sha256', { length: 64 }),
  currentSha256: varchar('current_sha256', { length: 64 }),
  proposedSha256: varchar('proposed_sha256', { length: 64 }),
  mergedSha256: varchar('merged_sha256', { length: 64 }),
  warningCodes: jsonb('warning_codes').$type<string[]>().default([]).notNull(),
  conflictDetails: jsonb('conflict_details').$type<Record<string, unknown>>().default({}).notNull(),
  status: varchar('status', { length: 16 }).default('pending').notNull(),
  draftId: uuid('draft_id').references(() => drafts.id, { onDelete: 'set null' }),
  memberProposalId: uuid('member_proposal_id')
    .references(() => memberProposals.id, { onDelete: 'set null' }),
  importedAt: timestamp('imported_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  check('content_pr_import_items_ordinal_check', sql`${table.ordinal} >= 0`),
  check(
    'content_pr_import_items_target_type_check',
    sql`${table.targetType} in ('article', 'member')`
  ),
  check(
    'content_pr_import_items_change_type_check',
    sql`${table.changeType} in ('added', 'modified', 'renamed', 'removed', 'invalid')`
  ),
  check(
    'content_pr_import_items_classification_check',
    sql`${table.classification} in ('safe_change', 'auto_merge', 'content_conflict', 'new_article', 'move_or_rename', 'deletion_proposal', 'path_conflict', 'invalid_file', 'unknown_syntax', 'high_risk_syntax', 'member_safe_change', 'member_auto_merge', 'member_conflict', 'member_deletion_proposal', 'member_sensitive_rejected', 'member_invalid')`
  ),
  check(
    'content_pr_import_items_status_check',
    sql`${table.status} in ('pending', 'imported', 'skipped', 'blocked')`
  ),
  check(
    'content_pr_import_items_proposed_id_check',
    sql`(${table.classification} = 'new_article' and ${table.articleId} is null and ${table.proposedArticleId} is not null) or (${table.classification} <> 'new_article' and ${table.proposedArticleId} is null)`
  ),
  uniqueIndex('content_pr_import_items_run_ordinal_unique').on(table.runId, table.ordinal),
  index('content_pr_import_items_run_index').on(table.runId, table.ordinal),
  index('content_pr_import_items_article_index').on(table.articleId),
  index('content_pr_import_items_member_index').on(table.memberId),
  index('content_pr_import_items_draft_index').on(table.draftId),
  index('content_pr_import_items_member_proposal_index').on(table.memberProposalId)
])

export const contentPrExternalActions = pgTable('content_pr_external_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => contentPrImportRuns.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  externalReference: varchar('external_reference', { length: 128 }),
  errorCode: varchar('error_code', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, table => [
  check(
    'content_pr_external_actions_action_check',
    sql`${table.action} in ('comment', 'close')`
  ),
  check(
    'content_pr_external_actions_status_check',
    sql`${table.status} in ('processing', 'succeeded', 'failed')`
  ),
  index('content_pr_external_actions_run_index').on(table.runId, table.createdAt)
])

export const articleRedirects = pgTable('article_redirects', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id, { onDelete: 'cascade' }),
  fromPublicPath: text('from_public_path').notNull(),
  toPublicPath: text('to_public_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  uniqueIndex('article_redirects_from_path_unique').on(table.fromPublicPath),
  index('article_redirects_article_index').on(table.articleId)
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

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  scope: varchar('scope', { length: 64 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, table => [
  primaryKey({
    columns: [table.scope, table.keyHash],
    name: 'rate_limit_buckets_primary_key'
  }),
  check('rate_limit_buckets_attempt_count_check', sql`${table.attemptCount} >= 0`),
  index('rate_limit_buckets_updated_at_index').on(table.updatedAt),
  index('rate_limit_buckets_blocked_until_index').on(table.blockedUntil)
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
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect
export type Member = typeof members.$inferSelect
export type MemberRevision = typeof memberRevisions.$inferSelect
export type MemberProposal = typeof memberProposals.$inferSelect
export type MemberCohort = typeof memberCohorts.$inferSelect
export type MemberApplication = typeof memberApplications.$inferSelect
export type Article = typeof articles.$inferSelect
export type ArticleRevision = typeof articleRevisions.$inferSelect
export type Draft = typeof drafts.$inferSelect
export type ReviewEvent = typeof reviewEvents.$inferSelect
export type PublishRecord = typeof publishRecords.$inferSelect
export type MediaAsset = typeof mediaAssets.$inferSelect
export type ArticleDeletionEvent = typeof articleDeletionEvents.$inferSelect
export type ContentExportJob = typeof contentExportJobs.$inferSelect
export type ContentReconciliationRun = typeof contentReconciliationRuns.$inferSelect
export type ContentImportRun = typeof contentImportRuns.$inferSelect
export type ContentPrImportRun = typeof contentPrImportRuns.$inferSelect
export type ContentPrImportItem = typeof contentPrImportItems.$inferSelect
export type EditLock = typeof editLocks.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
