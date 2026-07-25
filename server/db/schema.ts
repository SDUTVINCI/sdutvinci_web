import {
  check,
  index,
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
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  status: userStatusEnum('status').default('active').notNull(),
  ...timestamps
}, table => [
  check('users_account_format_check', sql`${table.account} ~ '^[a-z][a-z0-9]{2,31}$'`),
  uniqueIndex('users_account_unique').on(table.account),
  uniqueIndex('users_email_unique').on(table.email),
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
  ...timestamps
}, table => [
  uniqueIndex('members_member_key_unique').on(table.memberKey),
  uniqueIndex('members_source_path_unique').on(table.sourcePath)
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
export type AuditLog = typeof auditLogs.$inferSelect
