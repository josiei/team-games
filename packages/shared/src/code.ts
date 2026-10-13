import { asRoomCode, type RoomCode } from './ids.js'

/** Excludes O 0 I 1 S 5 — the pairs people misread off a shared screen. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789'
export const CODE_LENGTH = 6
const MAX_ATTEMPTS = 100

/** Largest multiple of the alphabet length that fits in a byte; bytes at or above it are rejected to avoid modulo bias. */
const BIAS_LIMIT = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length

export function generateCode(isTaken: (code: RoomCode) => boolean): RoomCode {
  const byte = new Uint8Array(1)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let out = ''
    while (out.length < CODE_LENGTH) {
      globalThis.crypto.getRandomValues(byte)
      if (byte[0]! < BIAS_LIMIT) out += CODE_ALPHABET[byte[0]! % CODE_ALPHABET.length]
    }
    const code = asRoomCode(out)
    if (!isTaken(code)) return code
  }
  throw new Error(`Join code space exhausted after ${MAX_ATTEMPTS} attempts`)
}

export function normalizeCode(input: string): RoomCode {
  return asRoomCode(input.replace(/[\s-]/g, '').toUpperCase())
}
