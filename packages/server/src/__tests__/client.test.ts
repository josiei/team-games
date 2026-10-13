import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDb } from '../db/client.js'

describe('createDb', () => {
  it('creates a missing parent directory for a file-backed database', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tg-db-'))
    try {
      const file = path.join(root, 'nested', 'data', 'team-games.sqlite')
      expect(existsSync(path.dirname(file))).toBe(false)
      createDb(file)
      expect(existsSync(file)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('still opens :memory: without touching the filesystem', () => {
    expect(() => createDb(':memory:')).not.toThrow()
  })
})
