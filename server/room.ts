import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Server, Socket } from 'socket.io'
import { z } from 'zod'
import {
  AVATARS,
  DEFAULT_ROOM_TITLE,
  MAX_AI_QUESTION_LENGTH,
  MAX_CONTEXT_LENGTH,
  MAX_QUESTION_LENGTH,
  PRESENTATION_SOURCES,
  REACTIONS,
  SEAT_COUNT,
  SLIDE_COUNT,
  isLivePresentation,
} from '../src/shared/protocol.js'
import { AiConfigError, answerQuestion } from './ai.js'
import type {
  Acknowledgement,
  ClientToServerEvents,
  Participant,
  RoomSnapshot,
  ServerToClientEvents,
} from '../src/shared/protocol.js'

export const MAX_ROOMS = 200
const MAX_PARTICIPANTS = SEAT_COUNT + 1
const MAX_QUESTIONS = 100

interface SocketData {
  roomId?: string
}

export type MeetingIO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>
type MeetingSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>
type Room = Omit<RoomSnapshot, 'participants'> & {
  participants: Map<string, Participant>
}
type ClientEvent = keyof ClientToServerEvents

class RoomError extends Error {}

const text = (maximum: number) =>
  z.string().trim().min(1).refine((value) => Array.from(value).length <= maximum)
const profileSchema = z.object({ name: text(20), avatar: z.enum(AVATARS) }).strict()
const joinSchema = profileSchema.extend({
  roomId: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
  demo: z.boolean(),
})
const questionIdSchema = z.object({ questionId: z.string().min(1).max(128) }).strict()
const presentationSchema = z
  .object({
    source: z.enum(PRESENTATION_SOURCES).optional(),
    slide: z.number().int().min(0).max(SLIDE_COUNT - 1).optional(),
  })
  .strict()
  .refine((value) => value.source !== undefined || value.slide !== undefined)
const signalSchema = z
  .object({
    to: z.string().min(1).max(128),
    description: z
      .object({
        type: z.enum(['offer', 'answer']),
        sdp: z.string().min(1).max(64 * 1024),
      })
      .strict()
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(4096),
        sdpMid: z.string().max(256).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.description !== undefined) !== (value.candidate !== undefined))

interface RatePolicy {
  capacity: number
  perSecond: number
}

const ratePolicies: Partial<Record<ClientEvent, RatePolicy>> = {
  'room:join': { capacity: 20, perSecond: 2 },
  'room:reaction': { capacity: 20, perSecond: 5 },
  'room:move': { capacity: 20, perSecond: 15 },
  'question:add': { capacity: 12, perSecond: 0.5 },
  'ai:ask': { capacity: 8, perSecond: 0.2 },
  'rtc:ready': { capacity: 12, perSecond: 2 },
  'rtc:signal': { capacity: 240, perSecond: 120 },
}
const defaultRatePolicy: RatePolicy = { capacity: 80, perSecond: 20 }
const totalRatePolicy: RatePolicy = { capacity: 400, perSecond: 140 }

function createRateLimiter() {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>()
  function consume(key: string, policy: RatePolicy) {
    const now = performance.now()
    const bucket = buckets.get(key) ?? { tokens: policy.capacity, updatedAt: now }
    bucket.tokens = Math.min(
      policy.capacity,
      bucket.tokens + ((now - bucket.updatedAt) / 1000) * policy.perSecond,
    )
    bucket.updatedAt = now
    buckets.set(key, bucket)
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }
  return {
    allow: (event: ClientEvent) =>
      consume('all', totalRatePolicy) && consume(event, ratePolicies[event] ?? defaultRatePolicy),
    clear: () => buckets.clear(),
  }
}

const channel = (roomId: string) => `meeting:${roomId}`

function snapshot(room: Room): RoomSnapshot {
  return {
    id: room.id,
    title: room.title,
    isDemo: room.isDemo,
    createdAt: room.createdAt,
    hostId: room.hostId,
    participants: Array.from(room.participants.values(), (participant) => ({ ...participant })),
    questions: room.questions.map((question) => ({ ...question, votes: [...question.votes] })),
    presentation: { ...room.presentation },
    context: room.context,
  }
}

function freeSeat(room: Room): number | undefined {
  const occupied = new Set(Array.from(room.participants.values(), (participant) => participant.seat))
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    if (!occupied.has(seat)) return seat
  }
  return undefined
}

function seatPosition(seat: number) {
  return { x: [18, 26, 34, 42, 58, 66, 74, 82][seat % 8], y: 57 + Math.floor(seat / 8) * 14 }
}

function seedDemo(room: Room) {
  const names = ['모모', '리오', '유나', '하루', '소라', '도담', '루미', '나루', '보리', '다온']
  const participants = names.map<Participant>((name, seat) => ({
    id: `demo:${randomUUID()}`,
    name,
    avatar: AVATARS[seat % AVATARS.length],
    seat,
    position: seatPosition(seat),
    handRaised: false,
    joinedAt: room.createdAt,
    isDemo: true,
  }))
  participants.forEach((participant) => room.participants.set(participant.id, participant))
  const questions = [
    '작은 아이디어를 첫 실험으로 옮길 때 무엇부터 해 보면 좋을까요?',
    '서로 다른 의견을 모아 함께 발전시키는 협업 방법이 궁금해요.',
    '오늘 나온 아이디어를 다음 만남까지 어떻게 이어 가면 좋을까요?',
  ]
  room.questions = questions.map((question, index) => ({
    id: `demo-question:${randomUUID()}`,
    authorId: participants[index].id,
    authorName: participants[index].name,
    avatar: participants[index].avatar,
    text: question,
    createdAt: room.createdAt,
    votes: participants.slice(0, 5 - index).map((participant) => participant.id),
    answered: false,
    isDemo: true,
  }))
}

function updateProfile(room: Room, participant: Participant, profile: z.infer<typeof profileSchema>) {
  participant.name = profile.name
  participant.avatar = profile.avatar
  for (const question of room.questions) {
    if (question.authorId === participant.id) {
      question.authorName = profile.name
      question.avatar = profile.avatar
    }
  }
}

export function attachRoomHandlers(io: MeetingIO, maxRooms = MAX_ROOMS) {
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > MAX_ROOMS) {
    throw new RangeError(`maxRooms must be an integer between 1 and ${MAX_ROOMS}`)
  }
  const rooms = new Map<string, Room>()
  const broadcast = (room: Room) => io.to(channel(room.id)).emit('room:state', snapshot(room))

  function leave(socket: MeetingSocket) {
    const roomId = socket.data.roomId
    delete socket.data.roomId
    if (!roomId) return
    void socket.leave(channel(roomId))
    const room = rooms.get(roomId)
    if (!room || !room.participants.delete(socket.id)) return
    for (const question of room.questions) {
      question.votes = question.votes.filter((id) => id !== socket.id)
    }
    // Map insertion order preserves actual arrival order, even when timestamps tie.
    const successor = Array.from(room.participants.values()).find((participant) => !participant.isDemo)
    if (!successor) {
      rooms.delete(roomId)
      return
    }
    if (room.hostId === socket.id || room.presentation.presenterId === socket.id) {
      room.hostId = successor.id
      successor.seat = null
      room.presentation.source = 'slides'
      room.presentation.presenterId = successor.id
    }
    broadcast(room)
  }

  io.on('connection', (socket) => {
    const limiter = createRateLimiter()

    function current() {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined
      const participant = room?.participants.get(socket.id)
      if (!room || !participant || participant.isDemo) {
        throw new RoomError('먼저 회의실에 입장해 주세요.')
      }
      return { room, participant }
    }

    function asHost() {
      const context = current()
      if (context.room.hostId !== socket.id) {
        throw new RoomError('진행자만 사용할 수 있는 기능입니다.')
      }
      return context
    }

    function questionById(room: Room, id: string) {
      const question = room.questions.find((entry) => entry.id === id)
      if (!question) throw new RoomError('질문을 찾을 수 없습니다.')
      return question
    }

    function on<P, R = RoomSnapshot | undefined>(
      event: ClientEvent,
      schema: z.ZodType<P>,
      action: (payload: P) => R | Promise<R>,
      withoutPayload = false,
    ) {
      socket.on(event, (...args: unknown[]) => {
        const last = args.at(-1)
        const acknowledgement = typeof last === 'function' ? (last as (reply: Acknowledgement<R>) => void) : undefined
        const values = acknowledgement ? args.slice(0, -1) : args
        const reply = (result: Acknowledgement<R>) => {
          if (acknowledgement) acknowledgement(result)
          else if (!result.ok) socket.emit('room:error', result.error)
        }
        void (async () => {
          try {
            if (!limiter.allow(event)) {
              throw new RoomError('요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.')
            }
            if (values.length !== (withoutPayload ? 0 : 1)) {
              throw new RoomError('입력 형식이 올바르지 않습니다.')
            }
            const parsed = schema.safeParse(withoutPayload ? undefined : values[0])
            if (!parsed.success) {
              throw new RoomError('입력 형식이나 길이가 올바르지 않습니다.')
            }
            const data = await action(parsed.data)
            reply({ ok: true, data })
          } catch (error) {
            if (!(error instanceof RoomError)) console.error(`Room event ${event} failed:`, error)
            reply({
              ok: false,
              error: error instanceof RoomError ? error.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.',
            })
          }
        })()
      })
    }

    on('room:join', joinSchema, (payload) => {
      let room = rooms.get(payload.roomId)
      const previous = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined
      if (room && room.isDemo !== payload.demo) {
        throw new RoomError('회의실의 데모 설정이 일치하지 않습니다.')
      }
      const existing = room?.participants.get(socket.id)
      if (room && previous === room && existing && !existing.isDemo) {
        updateProfile(room, existing, payload)
        broadcast(room)
        return snapshot(room)
      }
      const seat = room ? freeSeat(room) : null
      if (room && (room.participants.size >= MAX_PARTICIPANTS || seat === undefined)) {
        throw new RoomError('회의실이 가득 찼습니다. 빈 좌석이 생기면 다시 입장해 주세요.')
      }
      const replacesEmptyRoom =
        previous &&
        Array.from(previous.participants.values()).filter((participant) => !participant.isDemo).length === 1
      if (!room && rooms.size >= maxRooms && !replacesEmptyRoom) {
        throw new RoomError('열린 회의실이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
      }

      // Validate the destination before giving up membership or privileges in the old room.
      leave(socket)
      const participant: Participant = {
        id: socket.id,
        name: payload.name,
        avatar: payload.avatar,
        seat: seat ?? null,
        position: seat == null ? { x: 50, y: 90 } : seatPosition(seat),
        handRaised: false,
        joinedAt: Date.now(),
        isDemo: false,
      }
      if (!room) {
        room = {
          id: payload.roomId,
          title: DEFAULT_ROOM_TITLE,
          isDemo: payload.demo,
          createdAt: participant.joinedAt,
          hostId: socket.id,
          participants: new Map([[socket.id, participant]]),
          questions: [],
          presentation: { source: 'slides', slide: 0, presenterId: socket.id },
          context: '',
        }
        if (payload.demo) seedDemo(room)
        rooms.set(room.id, room)
      } else {
        room.participants.set(socket.id, participant)
        updateProfile(room, participant, payload)
      }
      socket.data.roomId = room.id
      void socket.join(channel(room.id))
      broadcast(room)
      return snapshot(room)
    })

    on('room:leave', z.undefined(), () => leave(socket), true)

    on('room:profile', profileSchema, (payload) => {
      const { room, participant } = current()
      updateProfile(room, participant, payload)
      broadcast(room)
    })

    on('room:seat', z.object({ seat: z.number().int().min(0).max(SEAT_COUNT - 1) }).strict(), ({ seat }) => {
      const { room, participant } = current()
      if (Array.from(room.participants.values()).some((entry) => entry.id !== socket.id && entry.seat === seat)) {
        throw new RoomError('이미 다른 참가자가 앉아 있는 자리입니다.')
      }
      participant.seat = seat
      participant.position = seatPosition(seat)
      broadcast(room)
    })

    on('room:move', z.object({
      x: z.number().min(10).max(90),
      y: z.number().min(48).max(91),
    }).strict(), (position) => {
      const { room, participant } = current()
      participant.seat = null
      participant.position = position
      broadcast(room)
    })

    on('room:hand', z.object({ raised: z.boolean() }).strict(), ({ raised }) => {
      const { room, participant } = current()
      participant.handRaised = raised
      broadcast(room)
    })

    on('room:reaction', z.object({ emoji: z.enum(REACTIONS) }).strict(), ({ emoji }) => {
      const { room } = current()
      io.to(channel(room.id)).emit('room:reaction', {
        id: randomUUID(),
        participantId: socket.id,
        emoji,
        createdAt: Date.now(),
      })
    })

    on('question:add', z.object({ text: text(MAX_QUESTION_LENGTH) }).strict(), (payload) => {
      const { room, participant } = current()
      if (room.questions.length >= MAX_QUESTIONS) {
        throw new RoomError('질문은 회의실마다 최대 100개까지 작성할 수 있습니다.')
      }
      room.questions.push({
        id: randomUUID(),
        authorId: socket.id,
        authorName: participant.name,
        avatar: participant.avatar,
        text: payload.text,
        createdAt: Date.now(),
        votes: [],
        answered: false,
        isDemo: false,
      })
      broadcast(room)
    })

    on('question:vote', questionIdSchema, ({ questionId }) => {
      const { room } = current()
      const question = questionById(room, questionId)
      question.votes = question.votes.includes(socket.id)
        ? question.votes.filter((id) => id !== socket.id)
        : [...question.votes, socket.id]
      broadcast(room)
    })

    on('question:answer', questionIdSchema, ({ questionId }) => {
      const { room } = asHost()
      const question = questionById(room, questionId)
      question.answered = !question.answered
      broadcast(room)
    })

    on('presentation:set', presentationSchema, (payload) => {
      const { room } = asHost()
      if (payload.source !== undefined) room.presentation.source = payload.source
      if (payload.slide !== undefined) room.presentation.slide = payload.slide
      room.presentation.presenterId = room.hostId
      broadcast(room)
    })

    on('room:title', z.object({ title: text(60) }).strict(), ({ title }) => {
      const { room } = asHost()
      room.title = title
      broadcast(room)
    })

    // Integration seam: the host-facing "start page" (built separately) will call this
    // to feed background material/resources to the room's AI assistant.
    on('room:context', z.object({ context: z.string().max(MAX_CONTEXT_LENGTH) }).strict(), ({ context }) => {
      const { room } = asHost()
      room.context = context
      broadcast(room)
    })

    on('ai:ask', z.object({ question: text(MAX_AI_QUESTION_LENGTH) }).strict(), async ({ question }) => {
      const { room } = current()
      try {
        const answer = await answerQuestion(room.context, question)
        return { answer }
      } catch (error) {
        throw new RoomError(error instanceof AiConfigError || error instanceof Error ? error.message : 'AI 도우미가 답변하지 못했습니다.')
      }
    })

    on('rtc:ready', z.undefined(), () => {
      const { room } = current()
      if (room.hostId === socket.id) {
        throw new RoomError('참가자만 화면 공유 연결을 요청할 수 있습니다.')
      }
      if (!isLivePresentation(room.presentation.source)) {
        throw new RoomError('화면 공유 중에만 연결할 수 있습니다.')
      }
      io.to(room.hostId).emit('rtc:viewer', { viewerId: socket.id })
    }, true)

    on('rtc:signal', signalSchema, (payload) => {
      const { room } = current()
      const target = room.participants.get(payload.to)
      if (!isLivePresentation(room.presentation.source)) {
        throw new RoomError('화면 공유 중에만 연결할 수 있습니다.')
      }
      if (
        !target ||
        target.isDemo ||
        target.id === socket.id ||
        (socket.id !== room.hostId && target.id !== room.hostId) ||
        io.sockets.sockets.get(target.id)?.data.roomId !== room.id
      ) {
        throw new RoomError('같은 회의실의 진행자와 참가자 사이에서만 연결할 수 있습니다.')
      }
      io.to(target.id).emit('rtc:signal', {
        from: socket.id,
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.candidate ? { candidate: payload.candidate } : {}),
      })
    })

    socket.on('disconnect', () => {
      leave(socket)
      limiter.clear()
    })
  })
}
