import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import express from 'express'
import type { ErrorRequestHandler } from 'express'
import { MATERIAL_MIME_TYPES, MAX_MATERIAL_BYTES, MAX_MATERIALS } from '../src/shared/protocol.js'
import type { RoomMaterial } from '../src/shared/protocol.js'
import type { RoomRegistry } from './room.js'

function matchesContent(extension: string, content: Buffer): boolean {
  if (extension === '.pdf') return content.subarray(0, 5).toString() === '%PDF-'
  if (extension === '.png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (extension === '.jpg' || extension === '.jpeg') return content[0] === 255 && content[1] === 216
  if (extension === '.pptx' || extension === '.docx') return content.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
    return !content.includes(0)
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

export function createMaterialsApi(registry: RoomRegistry, root: string) {
  const router = express.Router({ mergeParams: true })
  const cleanups = new Set<Promise<void>>()
  let uploading = 0
  const roomId = (value: unknown): string => typeof value === 'string' ? value : ''
  const token = (authorization: string | undefined) => authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''

  router.use('/:roomId/materials', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const permitted = registry.access(roomId(request.params.roomId), token(request.headers.authorization))
    if (!permitted) {
      response.status(401).json({ error: '이 방에 입장한 뒤 자료에 접근해 주세요.' })
      return
    }
    if (request.method === 'POST' && !permitted.isHost) {
      response.status(403).json({ error: 'Host만 자료를 업로드할 수 있어요.' })
      return
    }
    if (request.method === 'POST' && permitted.room.materials.length >= MAX_MATERIALS) {
      response.status(409).json({ error: `자료는 방마다 최대 ${MAX_MATERIALS}개까지 올릴 수 있어요.` })
      return
    }
    next()
  })

  router.get('/:roomId/materials', (request, response) => {
    const permitted = registry.access(roomId(request.params.roomId), token(request.headers.authorization))
    if (!permitted) { response.status(401).json({ error: '방 연결이 종료되었어요.' }); return }
    response.json({ roomId: permitted.room.id, materials: permitted.room.materials })
  })

  router.post('/:roomId/materials', (request, response, next) => {
    if (!request.is('application/octet-stream')) {
      response.status(415).json({ error: '파일 원본을 application/octet-stream 형식으로 보내 주세요.' })
      return
    }
    if (uploading >= 4) {
      response.status(429).json({ error: '자료 업로드가 몰리고 있어요. 잠시 후 다시 시도해 주세요.' })
      return
    }
    uploading += 1
    let released = false
    const release = () => { if (!released) { released = true; uploading -= 1 } }
    response.once('finish', release)
    response.once('close', release)
    next()
  }, express.raw({ type: 'application/octet-stream', limit: MAX_MATERIAL_BYTES }), async (request, response) => {
    const id = roomId(request.params.roomId)
    const accessToken = token(request.headers.authorization)
    const permitted = registry.access(id, accessToken)
    if (!permitted?.isHost) { response.status(403).json({ error: 'Host 연결이 종료되었어요.' }); return }
    const name = typeof request.query.name === 'string' ? request.query.name.trim() : ''
    const extension = extname(name).toLowerCase()
    const mimeType = MATERIAL_MIME_TYPES[extension]
    if (!name || name.length > 180 || /[/\\\u0000-\u001f\u007f]/u.test(name) || !mimeType) {
      response.status(400).json({ error: 'PDF, PPTX, DOCX, TXT, MD, CSV, PNG, JPG 자료만 올릴 수 있어요.' })
      return
    }
    const content: unknown = request.body
    if (!Buffer.isBuffer(content) || !content.length || !matchesContent(extension, content)) {
      response.status(400).json({ error: '파일이 비어 있거나 확장자와 내용 형식이 맞지 않아요.' })
      return
    }
    const materialId = randomUUID()
    const directory = join(root, id)
    const path = join(directory, materialId)
    await mkdir(directory, { recursive: true })
    await writeFile(path, content, { flag: 'wx' })
    const material: RoomMaterial = {
      id: materialId, roomId: id, name, mimeType, size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: Date.now(), uploadedBy: permitted.participantId,
      contentUrl: `/api/rooms/${id}/materials/${materialId}/content`,
    }
    if (!registry.addMaterial(id, accessToken, material)) {
      await rm(path, { force: true })
      response.status(409).json({ error: '방 상태가 변경되었거나 자료 개수 제한에 도달했어요.' })
      return
    }
    response.status(201).json(material)
  })

  router.get('/:roomId/materials/:materialId/content', (request, response, next) => {
    const id = roomId(request.params.roomId)
    const permitted = registry.access(id, token(request.headers.authorization))
    const material = permitted?.room.materials.find((entry) => entry.id === request.params.materialId)
    if (!material) { response.status(404).json({ error: '자료를 찾을 수 없어요.' }); return }
    response.download(join(root, id, material.id), material.name, {
      headers: { 'Content-Type': material.mimeType, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' },
    }, (error) => { if (error) next(error) })
  })

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return }
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large'
    if (!tooLarge) console.error('Material request failed:', error)
    response.status(tooLarge ? 413 : 500).json({
      error: tooLarge ? '파일 하나의 크기는 10MB 이하여야 해요.' : '자료를 처리하지 못했어요. 다시 시도해 주세요.',
    })
  }
  router.use(handleError)

  return {
    router,
    cleanRoom(id: string) {
      const cleanup = rm(join(root, id), { recursive: true, force: true })
        .catch((error: unknown) => { console.error('Room material cleanup failed:', error) })
      cleanups.add(cleanup)
      void cleanup.finally(() => cleanups.delete(cleanup))
    },
    flush: () => Promise.all(cleanups).then(() => undefined),
  }
}
