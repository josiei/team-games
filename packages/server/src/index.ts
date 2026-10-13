import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import { buildApp } from './app.js'
import { attachSocketServer } from './transport/socket.js'
import { InMemoryRoomStore } from './rooms/store.js'
import { Repo } from './db/repo.js'
import { createDb } from './db/client.js'
import type { RoomId } from '@tg/shared'
import type { RoomRuntime } from './rooms/runtime.js'

const DB_URL = process.env.DATABASE_URL ?? './data/team-games.sqlite'
const PORT = Number(process.env.PORT ?? 3000)

const repo = new Repo(createDb(DB_URL))
const store = new InMemoryRoomStore()
const runtimes = new Map<RoomId, RoomRuntime>()

const deps = { repo, store, runtimes }
const app = buildApp(deps)
const transport = attachSocketServer(app, deps)
// The HTTP routes broadcast through deps.send; app.ts stays transport-free.
Object.assign(deps, { send: transport.sendTo })

const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
await app.register(fastifyStatic, { root: webDist, wildcard: false })
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ code: 'NOT_FOUND' })
  return reply.sendFile('index.html')
})

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`team-games listening on :${PORT}`)
