import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>

const DDL = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS membership (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (workspace_id, user_id));
CREATE UNIQUE INDEX IF NOT EXISTS membership_unique ON membership(workspace_id, user_id);
CREATE TABLE IF NOT EXISTS room (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
  code TEXT NOT NULL,
  game_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  host_player_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS room_code_idx ON room(code);
CREATE INDEX IF NOT EXISTS room_ws_idx ON room(workspace_id);
CREATE TABLE IF NOT EXISTS player (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES room(id),
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  display_name TEXT NOT NULL, user_id TEXT REFERENCES user(id),
  token TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 1, joined_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS player_token_idx ON player(workspace_id, token);
CREATE TABLE IF NOT EXISTS game_result (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES room(id),
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  game_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS result_ws_idx ON game_result(workspace_id);
CREATE TABLE IF NOT EXISTS room_snapshot (
  room_id TEXT PRIMARY KEY REFERENCES room(id),
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  phase TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
`

export function createDb(url: string) {
  const sqlite = new Database(url)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(DDL)
  return drizzle(sqlite, { schema })
}
