/**
 * Spawns N headless clients against a running server so the game can be
 * played at real size before game night. Jackbox tests at 3 and 8; this
 * project's range is 4 and 12.
 *
 * Usage: pnpm playtest [playerCount] [baseUrl]
 *
 * Talks to the real HTTP and websocket endpoints, so the base URL can point at
 * production. Exits 0 once every bot has seen results, 1 on any failure.
 */
import WebSocket from 'ws'

const COUNT = Number(process.argv[2] ?? 12)
const BASE = (process.argv[3] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
const WS_BASE = BASE.replace(/^http/, 'ws')
/** Generous: carving is 3 minutes and four vote phases follow. */
const GIVE_UP_MS = 6 * 60_000

if (!Number.isInteger(COUNT) || COUNT < 2) {
  console.error('usage: pnpm playtest [playerCount >= 2] [baseUrl]')
  process.exit(2)
}

type Join = { roomId: string; playerId: string; playerToken: string }
type Stroke = { tool: 'cut'; size: number; points: [number, number][] }
type Snapshot = {
  type: 'snapshot'
  phase: string
  view: {
    kind: string
    award?: string
    gallery?: { slot: number }[]
    mySlot?: number
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    // No connection reuse: on Node 26, undici's fetch stalls 15-30s on a kept-alive
    // connection that sat idle between requests (the server itself is fine; plain
    // node:http keep-alive does not stall). This script makes few requests.
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

const jitter = (min: number, spread: number) => min + Math.random() * spread

/** A plausible carve: a handful of wandering multi-point cuts, kept inside the pumpkin. */
function plausibleStrokes(): Stroke[] {
  return Array.from({ length: 4 + Math.floor(Math.random() * 6) }, () => {
    let x = 0.3 + Math.random() * 0.4
    let y = 0.3 + Math.random() * 0.4
    const points: [number, number][] = [[x, y]]
    for (let i = 0; i < 12; i++) {
      x = Math.min(0.8, Math.max(0.2, x + (Math.random() - 0.5) * 0.06))
      y = Math.min(0.8, Math.max(0.2, y + (Math.random() - 0.5) * 0.06))
      points.push([x, y])
    }
    return { tool: 'cut' as const, size: 0.05 + Math.random() * 0.05, points }
  })
}

async function main() {
  const started = Date.now()
  const { code } = await post<{ code: string }>('/api/rooms', { gameId: 'pumpkin-carve' })
  console.log(`room ${code} on ${BASE} with ${COUNT} clients`)

  const joins: Join[] = []
  for (let i = 0; i < COUNT; i++) {
    joins.push(await post<Join>(`/api/rooms/${code}/join`, { displayName: `bot-${i + 1}` }))
  }

  const sockets: WebSocket[] = []
  let atResults = 0
  let lastPhase = ''
  let ready = 0
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`only ${atResults}/${COUNT} clients reached results in ${GIVE_UP_MS / 1000}s`)),
      GIVE_UP_MS)

    joins.forEach((join, index) => {
      const ws = new WebSocket(`${WS_BASE}/ws?room=${join.roomId}&token=${join.playerToken}`)
      sockets.push(ws)
      let submitted = false
      let counted = false
      const voted = new Set<string>()

      ws.on('open', () => { ready++ })
      ws.on('error', reject)
      ws.on('close', code => {
        // 1005/1000 are our own shutdown; anything else mid-game is a failure.
        if (!counted && code !== 1005 && code !== 1000) {
          reject(new Error(`bot-${index + 1} socket closed early (${code})`))
        }
      })
      ws.on('message', raw => {
        const message = JSON.parse(String(raw)) as { type: string } & Partial<Snapshot>
        if (message.type === 'error') { reject(new Error(`server error: ${String(raw)}`)); return }
        if (message.type !== 'snapshot') return
        const { phase, view } = message as Snapshot
        if (phase !== lastPhase) {
          lastPhase = phase
          console.log(`  +${((Date.now() - started) / 1000).toFixed(1)}s phase ${phase}`)
        }

        // Bots submit once, at staggered times, as real players finish at different moments.
        if (phase === 'carving' && view.kind === 'carving' && !submitted) {
          submitted = true
          setTimeout(() => ws.send(JSON.stringify({
            type: 'action', payload: { type: 'SUBMIT', strokes: plausibleStrokes() },
          })), jitter(500, 3000))
        }

        // One vote per phase, for any pumpkin that is not the bot's own.
        if (view.kind === 'voting' && !voted.has(phase)) {
          voted.add(phase)
          const options = (view.gallery ?? []).filter(g => g.slot !== view.mySlot)
          const pick = options[Math.floor(Math.random() * options.length)]
          if (pick) {
            setTimeout(() => ws.send(JSON.stringify({
              type: 'action', payload: { type: 'VOTE', award: view.award, slot: pick.slot },
            })), jitter(300, 2000))
          }
        }

        if (phase === 'results' && !counted) {
          counted = true
          atResults++
          if (atResults === COUNT) { clearTimeout(timer); resolve() }
        }
      })
    })
  })
  // Surface a rejection immediately instead of when `done` is finally awaited.
  done.catch(() => {})

  // Wait until every socket is open so nobody misses the first snapshot.
  while (ready < COUNT) {
    await new Promise(r => setTimeout(r, 50))
    if (Date.now() - started > 30_000) throw new Error('sockets did not all open within 30s')
  }
  await new Promise(r => setTimeout(r, 500))

  console.log(`all ${COUNT} sockets open (+${((Date.now() - started) / 1000).toFixed(1)}s)`)
  await post(`/api/rooms/${code}/start`, { playerToken: joins[0]!.playerToken })
  console.log(`started (+${((Date.now() - started) / 1000).toFixed(1)}s); watching until results`)

  try {
    await done
    console.log(`results reached (${atResults}/${COUNT} clients, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
  } finally {
    for (const ws of sockets) ws.close()
  }
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
