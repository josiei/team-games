import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  createdAt: integer('created_at').notNull(),
})

// Schema only in Tier 1. Defined now so auth is additive rather than a
// migration that rewrites every foreign key.
export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
})

export const memberships = sqliteTable('membership', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] })])

export const rooms = sqliteTable('room', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  code: text('code').notNull(),
  gameId: text('game_id').notNull(),
  status: text('status', { enum: ['open', 'playing', 'done'] }).notNull().default('open'),
  hostPlayerId: text('host_player_id'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('room_code_idx').on(t.code), index('room_ws_idx').on(t.workspaceId)])

export const players = sqliteTable('player', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  displayName: text('display_name').notNull(),
  userId: text('user_id').references(() => users.id),
  token: text('token').notNull(),
  connected: integer('connected', { mode: 'boolean' }).notNull().default(true),
  joinedAt: integer('joined_at').notNull(),
  // Lobby profile. Generic across games: a game that declares no teams simply
  // leaves `team` null.
  avatar: text('avatar').notNull().default(''),
  team: text('team'),
}, t => [index('player_token_idx').on(t.workspaceId, t.token)])

export const gameResults = sqliteTable('game_result', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  gameId: text('game_id').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('result_ws_idx').on(t.workspaceId)])

export const roomSnapshots = sqliteTable('room_snapshot', {
  roomId: text('room_id').primaryKey().references(() => rooms.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  phase: text('phase').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  // Player ids that were participants (not spectators) when the snapshot was taken.
  participants: text('participants', { mode: 'json' }),
  // Phase deadline (epoch ms); null for an untimed phase.
  endsAt: integer('ends_at'),
  updatedAt: integer('updated_at').notNull(),
}, t => [index('snapshot_ws_idx').on(t.workspaceId)])
