import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { Server } from 'socket.io'
import { attachRoomHandlers } from './room.js'
import type { MeetingIO } from './room.js'
import { createMaterialsApi } from './materials.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = basename(dirname(moduleDirectory)) === 'dist-server'
  ? resolve(moduleDirectory, '..', '..')
  : resolve(moduleDirectory, '..')
const frontendDirectory = resolve(projectDirectory, 'dist')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

function allowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (!request.headers.host) return false
  try {
    const secure = 'encrypted' in request.socket && request.socket.encrypted
    const target = new URL(`${secure ? 'https' : 'http'}://${request.headers.host}`)
    const source = new URL(origin)
    if (
      !['http:', 'https:'].includes(source.protocol) ||
      source.username ||
      source.password ||
      source.pathname !== '/' ||
      source.search ||
      source.hash
    ) return false
    if (source.origin === target.origin) return true
    return target.protocol === 'http:' &&
      source.protocol === 'http:' &&
      target.port === '4318' &&
      source.port === '4317' &&
      loopbackHosts.has(target.hostname) &&
      loopbackHosts.has(source.hostname)
  } catch {
    return false
  }
}

export interface MeetingServerOptions {
  maxRooms?: number
  uploadDirectory?: string
}

export function createMeetingServer(options: MeetingServerOptions = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })
  const routes = express.Router()
  app.use('/api/rooms', routes)
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: '찾을 수 없는 API입니다.' })
  })
  app.use(express.static(frontendDirectory, { index: false }))
  app.use((request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) || extname(request.path) || !request.accepts('html')) {
      next()
      return
    }
    response.sendFile(resolve(frontendDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
  app.use((_request, response) => {
    response.status(404).json({ error: '찾을 수 없는 주소입니다.' })
  })
  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error)
      return
    }
    const notFound = typeof error === 'object' && error !== null && 'status' in error && error.status === 404
    response.status(notFound ? 404 : 500).json({
      error: notFound ? '화면을 찾을 수 없습니다. 먼저 앱을 빌드해 주세요.' : '요청을 처리하지 못했습니다.',
    })
  }
  app.use(errorHandler)

  const httpServer = createServer(app)
  const io: MeetingIO = new Server(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 128 * 1024,
    allowRequest: (request, callback) => callback(null, allowedOrigin(request)),
    cors: (request, callback) => {
      callback(null, {
        origin: allowedOrigin(request as IncomingMessage) ? request.headers.origin ?? false : false,
        methods: ['GET', 'POST'],
      })
    },
  })
  // allowRequest covers handshakes; middleware also protects polling and transport upgrades with a sid.
  io.engine.use((request: IncomingMessage, _response: ServerResponse, next: (error?: Error) => void) => {
    next(allowedOrigin(request) ? undefined : new Error('허용되지 않은 연결입니다.'))
  })
  const registry = attachRoomHandlers(io, options.maxRooms, (id) => materials.cleanRoom(id))
  const materials = createMaterialsApi(registry, options.uploadDirectory ?? resolve(projectDirectory, 'data', 'uploads'))
  routes.use(materials.router)

  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= new Promise<void>((done, reject) => {
      // Discard Engine.IO transports before destroying HTTP connections, including idle polling clients.
      io.engine.close()
      void io.close((error?: NodeJS.ErrnoException) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else done()
      }).catch(reject)
      httpServer.closeAllConnections()
    })
    return closing.then(() => materials.flush())
  }
  return { app, httpServer, io, close }
}

const isEntrypoint = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isEntrypoint) {
  const host = process.env.HOST?.trim() || '127.0.0.1'
  const port = Number(process.env.PORT ?? 4318)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT는 0부터 65535 사이의 정수여야 합니다.')
    process.exitCode = 1
  } else {
    const meeting = createMeetingServer()
    meeting.httpServer.once('error', (error) => {
      console.error('회의 서버를 시작하지 못했습니다:', error.message)
      process.exitCode = 1
      void meeting.close()
    })
    meeting.httpServer.listen(port, host, () => {
      const address = meeting.httpServer.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      console.log(`Pixel Meet 서버: http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`)
    })
    const shutdown = () => {
      void meeting.close().catch((error: unknown) => {
        console.error('회의 서버를 종료하지 못했습니다:', error)
        process.exitCode = 1
      })
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }
}
