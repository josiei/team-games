declare const brand: unique symbol
export type Brand<K, T> = K & { readonly [brand]: T }

export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type RoomId = Brand<string, 'RoomId'>
export type PlayerId = Brand<string, 'PlayerId'>
export type RoomCode = Brand<string, 'RoomCode'>

export const asWorkspaceId = (s: string): WorkspaceId => s as WorkspaceId
export const asRoomId = (s: string): RoomId => s as RoomId
export const asPlayerId = (s: string): PlayerId => s as PlayerId
export const asRoomCode = (s: string): RoomCode => s as RoomCode

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 21-char url-safe id. 126 bits of entropy — collision-free at our scale. */
export function newId(): string {
  const bytes = new Uint8Array(21)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 21; i++) out += ALPHABET[bytes[i]! & 63]
  return out
}
