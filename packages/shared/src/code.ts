import { randomBytes } from 'node:crypto'
import { asRoomCode, type RoomCode } from './ids.js'

/** Excludes O 0 I 1 S 5 — the pairs people misread off a shared screen. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789'
export const CODE_LENGTH = 6
const MAX_ATTEMPTS = 100

export function generateCode(isTaken: (code: RoomCode) => boolean): RoomCode {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bytes = randomBytes(CODE_LENGTH)
    let out = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    }
    const code = asRoomCode(out)
    if (!isTaken(code)) return code
  }
  throw new Error(`Join code space exhausted after ${MAX_ATTEMPTS} attempts`)
}

export function normalizeCode(input: string): RoomCode {
  return asRoomCode(input.replace(/[\s-]/g, '').toUpperCase())
}
