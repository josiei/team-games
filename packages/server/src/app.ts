import Fastify, { type FastifyInstance } from 'fastify'
import { registerRoomRoutes, type AppDeps } from './http/rooms.js'

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  registerRoomRoutes(app, deps)
  return app
}
