/**
 * Generate the development clue pack.
 *
 * Every test, every Playwright run and every load test plays THIS pack, never
 * the Halloween one — the person who owns this repo is going to play the real
 * game and must not have seen it.
 *
 * So the content is synthetic and self-describing: the images are flat shapes
 * and the trivia asks about those shapes, which makes every answer correct by
 * construction. Nothing here needs fact-checking and no test quietly depends
 * on real-world trivia being true.
 *
 * Run: pnpm tsx scripts/gen-dev-pack.ts
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { choiceCountFor, type Pack } from '../packages/shared/src/fright-pack.js'

/**
 * Correct answer first, then enough wrong ones to fill the row. The wrong
 * options are drawn from a fixed pool so the generated pack is reproducible.
 */
function distractors(correct: string, pool: readonly string[], want: number): string[] {
  const wrong = pool.filter(c => c !== correct).slice(0, want - 1)
  if (wrong.length < want - 1) throw new Error(`pool too small for ${correct}`)
  return [correct, ...wrong]
}

// One accented and one long entry, so the choice grid's wrapping is exercised
// by the dev pack rather than discovered on game night.
const COLOURS = [
  'red', 'blue', 'green', 'orange',
  'gr\u00fcn', 'violet', 'ochre', 'teal',
  'a colour with a very long name indeed',
]

const OUT = join(process.cwd(), 'content', 'packs', 'dev')
// Clue images are served by the web client, so they live in its static
// assets and the pack stores the URL they will be fetched by. A bare
// filename would resolve against the page and silently never load.
const PUBLIC = join(
  process.cwd(), 'packages', 'web', 'public', 'games', 'fright-night', 'clues')
const URL_BASE = '/games/fright-night/clues'

/** Copy under a content-hashed name and return its public URL. */
function publish(source: string, bytes: Buffer): string {
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.png`
  mkdirSync(PUBLIC, { recursive: true })
  copyFileSync(source, join(PUBLIC, name))
  return `${URL_BASE}/${name}`
}
// Four rows, not two: choiceCountFor gives six options to the TOP TWO rows,
// so a two-row board would be six-everywhere and would never exercise the
// four-option grid. Four rows produce both counts with no special casing.
const VALUES = [100, 200, 300, 400]

type Rgb = [number, number, number]

const SHAPES = [
  { key: 'triangle', colour: 'red', rgb: [214, 48, 49] as Rgb, value: 100 },
  { key: 'circle', colour: 'blue', rgb: [52, 112, 220] as Rgb, value: 200 },
  { key: 'square', colour: 'green', rgb: [46, 160, 87] as Rgb, value: 300 },
  { key: 'diamond', colour: 'orange', rgb: [224, 134, 32] as Rgb, value: 400 },
]

function png(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const raw: number[] = []
  for (let y = 0; y < height; y++) {
    raw.push(0)
    for (let x = 0; x < width; x++) raw.push(...pixel(x, y))
  }
  const chunk = (tag: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let TABLE: number[] | null = null
function crc32(buf: Buffer): number {
  if (!TABLE) {
    TABLE = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
  }
  let c = 0xffffffff
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const BACKDROP: Rgb = [18, 16, 26]

function triangle(size: number, rgb: Rgb) {
  return (x: number, y: number): Rgb => {
    const half = (y / size) * (size / 2)
    return Math.abs(x - size / 2) <= half ? rgb : BACKDROP
  }
}

function circle(size: number, rgb: Rgb) {
  const r = size * 0.38
  return (x: number, y: number): Rgb => {
    const dx = x - size / 2, dy = y - size / 2
    return dx * dx + dy * dy <= r * r ? rgb : BACKDROP
  }
}

function square(size: number, rgb: Rgb) {
  const pad = size * 0.2
  return (x: number, y: number): Rgb =>
    x >= pad && x <= size - pad && y >= pad && y <= size - pad ? rgb : BACKDROP
}

function diamond(size: number, rgb: Rgb) {
  const half = size * 0.42
  return (x: number, y: number): Rgb =>
    Math.abs(x - size / 2) + Math.abs(y - size / 2) <= half ? rgb : BACKDROP
}

const DRAW: Record<string, (size: number, rgb: Rgb) => (x: number, y: number) => Rgb> = {
  triangle, circle, square, diamond,
}

mkdirSync(OUT, { recursive: true })

const SIZE = 192
const published: Record<string, string> = {}
for (const shape of SHAPES) {
  const bytes = png(SIZE, SIZE, DRAW[shape.key]!(SIZE, shape.rgb))
  const local = join(OUT, `${shape.key}.png`)
  writeFileSync(local, bytes)
  published[shape.key] = publish(local, bytes)
}

const pack: Pack = {
  id: 'dev',
  name: 'Dev Pack',
  values: VALUES,
  categories: [
    {
      id: 'dev-shapes',
      name: 'Dev Shapes',
      clues: SHAPES.map(shape => ({
        value: shape.value,
        kind: 'image' as const,
        file: published[shape.key]!,
        // Deliberately coarse: a flat shape has to survive a real mosaic.
        // Coarser on the cheap rows, as on the real board: a flat shape has
        // to survive a real mosaic.
        mosaic: 8 + VALUES.indexOf(shape.value) * 3,
        prompt: 'Which shape is this?',
        choices: distractors(shape.key, ['triangle', 'circle', 'square', 'diamond', 'hexagon', 'star'],
          choiceCountFor(shape.value, VALUES)),
        source: 'generated by scripts/gen-dev-pack.ts',
        verifiedAt: '2026-10-25',
      })),
    },
    {
      id: 'dev-colours',
      name: 'Dev Colours',
      clues: SHAPES.map(shape => ({
        value: shape.value,
        kind: 'text' as const,
        prompt: `What colour is the ${shape.key} in the ${shape.value} clue?`,
        choices: distractors(shape.colour, COLOURS, choiceCountFor(shape.value, VALUES)),
        source: 'generated by scripts/gen-dev-pack.ts',
        verifiedAt: '2026-10-25',
      })),
    },
  ],
}

writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`)
console.log(`dev pack written to ${OUT}`)
