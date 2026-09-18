import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { io as createClient } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { createMeetingServer } from './index.js'
import type { MeetingServerOptions } from './index.js'
import {
  AVATARS,
  DEFAULT_ROOM_TITLE,
  MAX_QUESTION_LENGTH,
  SEAT_COUNT,
  SLIDE_COUNT,
} from '../src/shared/protocol.js'
import type {
  Acknowledgement,
  ClientToServerEvents,
  RoomSnapshot,
  RoomJoinResult,
  ServerToClientEvents,
} from '../src/shared/protocol.js'

type Client = Socket<ServerToClientEvents, ClientToServerEvents>
type IncomingEvents = ServerToClientEvents & { disconnect: (reason: string) => void }
type ClientEvent = keyof ClientToServerEvents
const WAIT_MS = 5000
const testOptions = { timeout: 30_000 }
const states = new WeakMap<Client, RoomSnapshot>()

function nextEvent<E extends keyof IncomingEvents>(
  socket: Client,
  event: E,
  matches: (value: Parameters<IncomingEvents[E]>[0]) => boolean = () => true,
) {
  return new Promise<Parameters<IncomingEvents[E]>[0]>((resolve, reject) => {
    const emitter = socket as Socket
    const timer = setTimeout(() => {
      emitter.off(event, listener)
      reject(new Error(`Timed out waiting for ${event}`))
    }, WAIT_MS)
    const listener = (value: Parameters<IncomingEvents[E]>[0]) => {
      if (!matches(value)) return
      clearTimeout(timer)
      emitter.off(event, listener)
      resolve(value)
    }
    emitter.on(event, listener)
  })
}

// The inverse of nextEvent: confirms an event does NOT arrive within a short window,
// for asserting that something stays private and is never broadcast.
function noEvent<E extends keyof IncomingEvents>(socket: Client, event: E, windowMs = 300) {
  return new Promise<void>((resolve, reject) => {
    const emitter = socket as Socket
    const listener = () => {
      clearTimeout(timer)
      emitter.off(event, listener)
      reject(new Error(`Expected no ${event}, but one arrived`))
    }
    const timer = setTimeout(() => {
      emitter.off(event, listener)
      resolve()
    }, windowMs)
    emitter.on(event, listener)
  })
}

function request<T = undefined>(socket: Client, event: ClientEvent, ...args: unknown[]) {
  return new Promise<Acknowledgement<T>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out acknowledging ${event}`)), WAIT_MS)
    ;(socket as Socket).emit(event, ...args, (reply: Acknowledgement<T>) => {
      clearTimeout(timer)
      resolve(reply)
    })
  })
}

async function good<T = undefined>(socket: Client, event: ClientEvent, ...args: unknown[]): Promise<T> {
  const reply = await request<T>(socket, event, ...args)
  if (!reply.ok) assert.fail(`${event}: ${reply.error}`)
  return reply.data
}

async function bad(socket: Client, event: ClientEvent, ...args: unknown[]) {
  const reply = await request(socket, event, ...args)
  if (reply.ok) assert.fail(`Expected ${event} to be rejected`)
  assert.match(reply.error, /[가-힣]/)
  return reply.error
}

function latest(socket: Client) {
  const state = states.get(socket)
  assert.ok(state, 'The client must have received an authoritative snapshot')
  return state
}

async function mutate(socket: Client, event: ClientEvent, ...args: unknown[]) {
  assert.equal(await good(socket, event, ...args), undefined)
  // A sender's room:state is ordered before its acknowledgement on the same connection.
  return latest(socket)
}

async function join(socket: Client, roomId: string, name = '참가자', demo = false) {
  const result = await good<RoomJoinResult>(socket, 'room:join', {
    roomId, name, avatar: 'mint', demo, role: 'host',
  })
  const { accessToken, role, ...room } = result
  assert.equal(accessToken.length, 64)
  assert.equal(role, room.hostId === socket.id ? 'host' : 'attendee')
  assert.deepEqual(latest(socket), room)
  return room
}

function handshake(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.once('error', fail)
      response.once('end', () => {
        clearTimeout(timer)
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
      })
    })
    const fail = (error: Error) => {
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => request.destroy(new Error('Handshake timed out')), WAIT_MS)
    request.once('error', fail)
    request.end()
  })
}

async function fixture(t: TestContext, options: MeetingServerOptions = {}) {
  const meeting = createMeetingServer(options)
  const clients = new Set<Client>()
  t.after(async () => {
    for (const socket of clients) socket.disconnect()
    await meeting.close()
  })
  await new Promise<void>((resolve, reject) => {
    meeting.httpServer.once('error', reject)
    meeting.httpServer.listen(0, '127.0.0.1', () => {
      meeting.httpServer.off('error', reject)
      resolve()
    })
  })
  const address = meeting.httpServer.address() as AddressInfo
  const url = `http://127.0.0.1:${address.port}`
  const connect = async (extraHeaders: Record<string, string> = {}) => {
    const socket: Client = createClient(url, {
      autoConnect: false,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: WAIT_MS,
      extraHeaders,
    })
    clients.add(socket)
    socket.on('room:state', (room) => states.set(socket, room))
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        socket.off('connect', connected)
        socket.off('connect_error', failed)
        if (error) reject(error)
        else resolve()
      }
      const connected = () => finish()
      const failed = (error: Error) => finish(error)
      const timer = setTimeout(() => finish(new Error('Connection timed out')), WAIT_MS)
      socket.once('connect', connected)
      socket.once('connect_error', failed)
      socket.connect()
    })
    return socket
  }
  return { ...meeting, url, connect }
}

test('factory is import-safe, serves health, and closes active or unstarted servers idempotently', testOptions, async (t) => {
  const unstarted = createMeetingServer()
  assert.equal(unstarted.httpServer.listening, false)
  await unstarted.close()
  await unstarted.close()

  const meeting = await fixture(t)
  const response = await fetch(`${meeting.url}/api/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(response.headers.get('x-powered-by'), null)
  const missing = await fetch(`${meeting.url}/api/missing`)
  assert.equal(missing.status, 404)
  assert.match((await missing.json() as { error: string }).error, /[가-힣]/)
  assert.equal((await fetch(`${meeting.url}/missing-asset.js`)).status, 404)

  const client = await meeting.connect()
  await join(client, 'closing-room')
  await Promise.all([nextEvent(client, 'disconnect'), meeting.close()])
  assert.equal(meeting.httpServer.listening, false)
  assert.equal(client.connected, false)
  await meeting.close()
})

test('websocket and polling origins allow only same-origin or explicit loopback development origins', testOptions, async (t) => {
  const meeting = await fixture(t)
  await meeting.connect()
  await meeting.connect({ Origin: meeting.url })
  for (const origin of ['https://untrusted.example', 'null', 'not-an-origin', 'http://localhost:4317']) {
    await assert.rejects(meeting.connect({ Origin: origin }))
  }

  const endpoint = `${meeting.url}/socket.io/?EIO=4&transport=polling`
  const sameOrigin = await handshake(endpoint, { Origin: meeting.url })
  assert.equal(sameOrigin.status, 200)
  assert.equal(sameOrigin.headers['access-control-allow-origin'], meeting.url)
  const denied = await handshake(endpoint, { Origin: 'https://untrusted.example' })
  assert.ok(denied.status === 400 || denied.status === 403)
  assert.equal(denied.headers['access-control-allow-origin'], undefined)
  const session = JSON.parse(sameOrigin.body.slice(1)) as { sid: string }
  const deniedSession = await handshake(`${endpoint}&sid=${session.sid}`, { Origin: 'https://untrusted.example' })
  assert.ok(deniedSession.status === 400 || deniedSession.status === 403)

  for (const origin of ['http://localhost:4317', 'http://127.0.0.1:4317', 'http://[::1]:4317']) {
    const development = await handshake(endpoint, { Host: '127.0.0.1:4318', Origin: origin })
    assert.equal(development.status, 200)
    assert.equal(development.headers['access-control-allow-origin'], origin)
  }
  const remoteHost = await handshake(endpoint, { Host: 'meeting.example:4318', Origin: 'http://localhost:4317' })
  assert.ok(remoteHost.status === 400 || remoteHost.status === 403)
})

test('joining creates isolated seeded real rooms, trims Unicode profiles, and is idempotent', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, outsider, unjoined] = await Promise.all([connect(), connect(), connect(), connect()])
  const first = await join(host, 'room-alpha', '  민트  ')
  assert.equal(first.id, 'room-alpha')
  assert.equal(first.hostId, host.id)
  assert.equal(first.title, DEFAULT_ROOM_TITLE)
  assert.equal(first.isDemo, false)
  const samples = first.participants.filter((participant) => participant.isDemo)
  assert.equal(samples.length, 8)
  assert.equal(first.participants.length, samples.length + 1)
  assert.equal(first.participants.filter((participant) => !participant.isDemo).length, 1)
  assert.deepEqual(first.presentation, { source: 'slides', slide: 0, presenterId: host.id })
  assert.equal(first.participants[0].name, '민트')
  assert.equal(first.participants[0].seat, null)
  assert.equal(first.participants[0].isDemo, false)
  assert.equal(first.questions.length, 3)
  assert.ok(first.questions.every((question) => question.isDemo))

  const second = await join(viewer, 'room-alpha', '💡'.repeat(20))
  assert.equal(second.hostId, host.id)
  assert.equal(second.participants.find((participant) => participant.id === viewer.id)?.seat, samples.length)
  assert.deepEqual(second.participants.filter((participant) => participant.isDemo), samples)
  assert.deepEqual(second.questions, first.questions)
  const other = await join(outsider, 'room-beta')
  assert.equal(other.hostId, outsider.id)
  assert.deepEqual(other.participants.filter((participant) => !participant.isDemo).map((participant) => participant.id), [outsider.id])
  assert.equal(other.participants.filter((participant) => participant.isDemo).length, samples.length)
  assert.equal(other.questions.length, first.questions.length)
  assert.ok(other.participants.every((participant) => !first.participants.some((entry) => entry.id === participant.id)))
  assert.ok(other.questions.every((question) => !first.questions.some((entry) => entry.id === question.id)))
  await bad(unjoined, 'room:hand', { raised: true })
  await bad(unjoined, 'room:reaction', { emoji: '👏' })
  await bad(unjoined, 'question:add', { text: '아직 입장하지 않았어요.' })

  const updated = await join(viewer, 'room-alpha', '  새 이름  ')
  assert.equal(updated.participants.length, samples.length + 2)
  assert.equal(updated.participants.filter((participant) => !participant.isDemo).length, 2)
  assert.equal(updated.participants.find((participant) => participant.id === viewer.id)?.seat, samples.length)
  assert.equal(updated.participants.find((participant) => participant.id === viewer.id)?.name, '새 이름')
  assert.deepEqual(updated.participants.filter((participant) => participant.isDemo), samples)
  assert.deepEqual(updated.questions, first.questions)
  const outsideStates: RoomSnapshot[] = []
  outsider.on('room:state', (room) => outsideStates.push(room))
  await Promise.all([
    nextEvent(host, 'room:state', (room) => room.participants.some((participant) => participant.id === viewer.id && participant.handRaised)),
    good(viewer, 'room:hand', { raised: true }),
  ])
  await mutate(outsider, 'room:hand', { raised: false })
  assert.ok(outsideStates.every((room) => room.id === 'room-beta'))
  assert.equal(latest(outsider).participants.length, samples.length + 1)
  assert.deepEqual(latest(outsider).questions, other.questions)
})

test('invalid runtime payloads, absent acknowledgements, and non-function acknowledgements are safe', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const client = await connect()
  await join(client, 'runtime-room')
  const invalid: [ClientEvent, unknown[]][] = [
    ['room:join', [null]],
    ['room:join', [{ roomId: 'ab', name: '이름', avatar: 'mint', demo: false }]],
    ['room:join', [{ roomId: 'bad room', name: '이름', avatar: 'mint', demo: false }]],
    ['room:join', [{ roomId: 'x'.repeat(65), name: '이름', avatar: 'mint', demo: false }]],
    ['room:join', [{ roomId: 'valid-room', name: '이름', avatar: 'mint', demo: 'false' }]],
    ['room:join', [{ roomId: 'valid-room', name: '이름', avatar: 'mint' }]],
    ['room:profile', [null]],
    ['room:profile', [{ name: ' ', avatar: 'mint' }]],
    ['room:profile', [{ name: '💡'.repeat(21), avatar: 'mint' }]],
    ['room:profile', [{ name: '이름', avatar: 'unknown' }]],
    ['room:seat', []],
    ['room:seat', [null]],
    ['room:seat', [{ seat: -1 }]],
    ['room:seat', [{ seat: SEAT_COUNT }]],
    ['room:seat', [{ seat: 0.5 }]],
    ['room:seat', [{ seat: '0' }]],
    ['room:seat', [{ seat: null }]],
    ['room:hand', [{ raised: 'true' }]],
    ['room:hand', [true]],
    ['room:reaction', [{ emoji: '🔥' }]],
    ['room:reaction', [{ emoji: '👏', participantId: 'spoofed' }]],
    ['question:add', [{ text: 42 }]],
    ['question:add', [null]],
    ['question:vote', [{ questionId: 42 }]],
    ['question:answer', [{}]],
    ['presentation:set', [null]],
    ['presentation:set', [{}]],
    ['presentation:set', [{ source: 'camera' }]],
    ['presentation:set', [{ presenterId: 'spoofed', source: 'screen' }]],
    ['room:title', [{ title: ' \n ' }]],
    ['room:title', [{ title: null }]],
    ['rtc:signal', [null]],
    ['rtc:ready', [null]],
    ['room:leave', ['not-an-ack']],
  ]
  for (const [event, args] of invalid) await bad(client, event, ...args)

  for (const [event, args] of [
    ['room:seat', [null]],
    ['room:hand', [{ raised: true }, { not: 'a function' }]],
    ['rtc:ready', ['not-a-function']],
    ['room:join', []],
  ] as [ClientEvent, unknown[]][]) {
    const error = nextEvent(client, 'room:error')
    ;(client as Socket).emit(event, ...args)
    assert.match(await error, /[가-힣]/)
  }
  assert.equal(latest(client).participants[0].handRaised, false)
  const state = nextEvent(client, 'room:state', (room) => room.participants[0].handRaised)
  ;(client as Socket).emit('room:hand', { raised: true })
  assert.equal((await state).participants[0].handRaised, true)
  assert.equal((await mutate(client, 'room:title', { title: '안전하게 계속 진행해요' })).title, '안전하게 계속 진행해요')
})

test('seats are exclusive under simultaneous requests, hosts can sit, and leaving releases seats', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, first, second, newcomer] = await Promise.all([connect(), connect(), connect(), connect()])
  const initial = await join(host, 'seat-room')
  const sampleCount = initial.participants.filter((participant) => participant.isDemo).length
  const hostSeat = sampleCount + 5
  const contestedSeat = sampleCount + 3
  await join(first, 'seat-room')
  await join(second, 'seat-room')
  assert.equal((await mutate(host, 'room:seat', { seat: hostSeat })).participants.find((participant) => participant.id === host.id)?.seat, hostSeat)
  assert.match(await bad(first, 'room:seat', { seat: hostSeat }), /자리/)

  const results = await Promise.all([
    request(first, 'room:seat', { seat: contestedSeat }),
    request(second, 'room:seat', { seat: contestedSeat }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  const winner = results[0].ok ? first : second
  const loser = results[0].ok ? second : first
  const winnerId = winner.id
  const occupied = await mutate(host, 'room:hand', { raised: false })
  assert.equal(occupied.participants.filter((participant) => participant.seat === contestedSeat).length, 1)
  const seats = occupied.participants.map((participant) => participant.seat)
  assert.equal(new Set(seats).size, seats.length)

  await Promise.all([
    nextEvent(host, 'room:state', (room) => !room.participants.some((participant) => participant.id === winnerId)),
    good(winner, 'room:leave'),
  ])
  await bad(winner, 'room:hand', { raised: true })
  const released = await mutate(loser, 'room:seat', { seat: contestedSeat })
  assert.equal(released.participants.find((participant) => participant.id === loser.id)?.seat, contestedSeat)
  const arrived = await join(newcomer, 'seat-room')
  assert.equal(arrived.participants.find((participant) => participant.id === newcomer.id)?.seat, sampleCount)
})

test('hands and authoritative reactions broadcast only within the room, with conservative per-socket limits', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, outsider] = await Promise.all([connect(), connect(), connect()])
  await join(host, 'reaction-room')
  await join(viewer, 'reaction-room')
  await join(outsider, 'reaction-outside')
  const [raised] = await Promise.all([
    nextEvent(host, 'room:state', (room) => room.participants.some((participant) => participant.id === viewer.id && participant.handRaised)),
    good(viewer, 'room:hand', { raised: true }),
  ])
  assert.equal(raised.participants.find((participant) => participant.id === viewer.id)?.handRaised, true)
  assert.equal((await mutate(viewer, 'room:hand', { raised: false })).participants.find((participant) => participant.id === viewer.id)?.handRaised, false)

  let outsideReactions = 0
  outsider.on('room:reaction', () => { outsideReactions += 1 })
  const before = Date.now()
  const [hostReaction, viewerReaction] = await Promise.all([
    nextEvent(host, 'room:reaction'),
    nextEvent(viewer, 'room:reaction'),
    good(viewer, 'room:reaction', { emoji: '👏' }),
  ])
  assert.deepEqual(hostReaction, viewerReaction)
  assert.equal(hostReaction.participantId, viewer.id)
  assert.equal(hostReaction.emoji, '👏')
  assert.match(hostReaction.id, /^[0-9a-f-]{36}$/)
  assert.ok(hostReaction.createdAt >= before && hostReaction.createdAt <= Date.now())
  await mutate(outsider, 'room:hand', { raised: false })
  assert.equal(outsideReactions, 0)

  await Promise.all(Array.from({ length: 6 }, () => good(viewer, 'room:reaction', { emoji: '💡' })))
  const burst = await Promise.all(Array.from({ length: 80 }, () => request(viewer, 'room:reaction', { emoji: '🎉' })))
  assert.ok(burst.some((reply) => reply.ok))
  assert.ok(burst.some((reply) => !reply.ok && reply.error.includes('빠릅니다')))
  await good(host, 'room:reaction', { emoji: '👍' })
  await good(viewer, 'room:hand', { raised: true })
})

test('questions trim Unicode text, update author profiles, toggle unique votes, and remove departing live votes', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, author] = await Promise.all([connect(), connect()])
  const initial = await join(host, 'question-room', '진행자')
  await join(author, 'question-room', '처음 이름')
  let room = await mutate(author, 'question:add', { text: '  첫 아이디어를 함께 키울까요? \n' })
  const created = room.questions.find((question) => !question.isDemo)
  assert.ok(created)
  const questionId = created.id
  assert.equal(created.text, '첫 아이디어를 함께 키울까요?')
  assert.equal(created.authorId, author.id)
  assert.equal(created.authorName, '처음 이름')
  assert.equal(created.isDemo, false)
  assert.equal(created.answered, false)
  assert.deepEqual(created.votes, [])
  room = await mutate(author, 'question:add', { text: '💡'.repeat(MAX_QUESTION_LENGTH) })
  const longQuestion = room.questions.find((question) => !question.isDemo && question.id !== questionId)
  assert.ok(longQuestion)
  assert.equal(Array.from(longQuestion.text).length, MAX_QUESTION_LENGTH)
  await bad(author, 'question:add', { text: '💡'.repeat(MAX_QUESTION_LENGTH + 1) })
  await bad(author, 'question:add', { text: ' \n\t ' })

  room = await mutate(author, 'room:profile', { name: '  유나  ', avatar: 'rose' })
  assert.equal(room.participants.find((participant) => participant.id === author.id)?.name, '유나')
  assert.ok(room.questions.filter((question) => question.authorId === author.id).every((question) => question.authorName === '유나' && question.avatar === 'rose'))
  room = await mutate(host, 'question:vote', { questionId })
  assert.deepEqual(room.questions.find((question) => question.id === questionId)?.votes, [host.id])
  room = await mutate(host, 'question:vote', { questionId })
  assert.deepEqual(room.questions.find((question) => question.id === questionId)?.votes, [])
  await mutate(host, 'question:vote', { questionId })
  room = await mutate(author, 'question:vote', { questionId })
  assert.deepEqual(new Set(room.questions.find((question) => question.id === questionId)?.votes), new Set([host.id, author.id]))
  await bad(host, 'question:vote', { questionId: 'does-not-exist' })
  await bad(host, 'question:answer', { questionId: 'does-not-exist' })
  const authorId = author.id
  const [remaining] = await Promise.all([
    nextEvent(host, 'room:state', (state) => !state.participants.some((participant) => participant.id === authorId)),
    good(author, 'room:leave'),
  ])
  assert.deepEqual(remaining.questions.find((question) => question.id === questionId)?.votes, [host.id])
  assert.equal(remaining.questions.find((question) => question.id === questionId)?.authorName, '유나')
  assert.equal(remaining.questions.length, initial.questions.length + 2)
  assert.deepEqual(remaining.questions.filter((question) => question.isDemo), initial.questions)
})

test('only the host controls answered status, title, and bounded slides without implicit screen stopping', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer] = await Promise.all([connect(), connect()])
  await join(host, 'presentation-room')
  await join(viewer, 'presentation-room')
  const question = (await mutate(viewer, 'question:add', { text: '함께 어떤 실험을 해 볼까요?' })).questions.find((entry) => !entry.isDemo)
  assert.ok(question)
  const questionId = question.id
  for (const [event, payload] of [
    ['question:answer', { questionId }],
    ['room:title', { title: '권한 없는 변경' }],
    ['presentation:set', { source: 'screen', slide: 1 }],
    ['presentation:set', { source: 'teams', slide: 1 }],
  ] as [ClientEvent, unknown][]) {
    assert.match(await bad(viewer, event, payload), /진행자/)
  }

  assert.equal((await mutate(host, 'question:answer', { questionId })).questions.find((entry) => entry.id === questionId)?.answered, true)
  assert.equal((await mutate(host, 'question:answer', { questionId })).questions.find((entry) => entry.id === questionId)?.answered, false)
  assert.equal((await mutate(host, 'room:title', { title: '  함께 만드는 아이디어  ' })).title, '함께 만드는 아이디어')
  assert.equal((await mutate(host, 'room:title', { title: `  ${'💡'.repeat(60)}  ` })).title, '💡'.repeat(60))
  await bad(host, 'room:title', { title: '💡'.repeat(61) })
  for (const slide of [-1, SLIDE_COUNT, 1.5, null, '1']) {
    await bad(host, 'presentation:set', { slide })
  }
  let room = await mutate(host, 'presentation:set', { source: 'screen' })
  assert.deepEqual(room.presentation, { source: 'screen', slide: 0, presenterId: host.id })
  const [viewerState] = await Promise.all([
    nextEvent(viewer, 'room:state', (state) => state.presentation.slide === SLIDE_COUNT - 1),
    good(host, 'presentation:set', { slide: SLIDE_COUNT - 1 }),
  ])
  assert.deepEqual(viewerState.presentation, { source: 'screen', slide: SLIDE_COUNT - 1, presenterId: host.id })
  room = await mutate(host, 'presentation:set', { source: 'slides' })
  assert.deepEqual(room.presentation, { source: 'slides', slide: SLIDE_COUNT - 1, presenterId: host.id })
})

for (const source of ['screen', 'teams'] as const) {
test(`RTC relays validated host-viewer descriptions and ICE only during same-room ${source} sharing`, testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, otherViewer, outsider] = await Promise.all([connect(), connect(), connect(), connect()])
  await join(host, 'rtc-room')
  await join(viewer, 'rtc-room')
  await join(otherViewer, 'rtc-room')
  await join(outsider, 'rtc-outside')
  await bad(viewer, 'rtc:ready')
  await mutate(host, 'presentation:set', { source })
  await mutate(outsider, 'presentation:set', { source })
  await bad(host, 'rtc:ready')
  const [ready] = await Promise.all([
    nextEvent(host, 'rtc:viewer'),
    good(viewer, 'rtc:ready'),
  ])
  assert.deepEqual(ready, { viewerId: viewer.id })

  const offer = { type: 'offer' as const, sdp: 'v=0\r\na=sendonly\r\n' }
  const [offered] = await Promise.all([
    nextEvent(viewer, 'rtc:signal'),
    good(host, 'rtc:signal', { to: viewer.id, description: offer }),
  ])
  assert.deepEqual(offered, { from: host.id, description: offer })
  const answer = { type: 'answer' as const, sdp: 'v=0\r\na=recvonly\r\n' }
  const [answered] = await Promise.all([
    nextEvent(host, 'rtc:signal'),
    good(viewer, 'rtc:signal', { to: host.id, description: answer }),
  ])
  assert.deepEqual(answered, { from: viewer.id, description: answer })
  const candidate = {
    candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 5000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'local-only',
  }
  const [ice] = await Promise.all([
    nextEvent(host, 'rtc:signal'),
    good(viewer, 'rtc:signal', { to: host.id, candidate }),
  ])
  assert.deepEqual(ice, { from: viewer.id, candidate })
  const end = { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null }
  const [ended] = await Promise.all([
    nextEvent(viewer, 'rtc:signal'),
    good(host, 'rtc:signal', { to: viewer.id, candidate: end }),
  ])
  assert.deepEqual(ended, { from: host.id, candidate: end })

  let forbiddenSignals = 0
  for (const socket of [host, viewer, otherViewer, outsider]) {
    socket.on('rtc:signal', () => { forbiddenSignals += 1 })
  }
  for (const [sender, to] of [
    [host, outsider.id],
    [outsider, host.id],
    [viewer, otherViewer.id],
    [host, host.id],
    [host, 'not-a-participant'],
  ] as [Client, string][]) {
    await bad(sender, 'rtc:signal', { to, description: offer })
  }
  for (const payload of [
    { to: viewer.id },
    { to: viewer.id, description: offer, from: 'spoofed' },
    { to: viewer.id, description: { type: 'pranswer', sdp: 'v=0' } },
    { to: viewer.id, description: { type: 'offer', sdp: 'x'.repeat(64 * 1024 + 1) } },
    { to: viewer.id, description: { type: 'offer', sdp: '' } },
    { to: viewer.id, candidate: { candidate: 1 } },
    { to: viewer.id, candidate: { candidate: 'x'.repeat(4097) } },
    { to: viewer.id, candidate: { candidate: '', sdpMid: 0 } },
    { to: viewer.id, candidate: { candidate: '', sdpMLineIndex: -1 } },
    { to: viewer.id, candidate: { candidate: '', usernameFragment: [] } },
    { to: viewer.id, description: offer, candidate },
  ]) await bad(host, 'rtc:signal', payload)
  await Promise.all([host, viewer, otherViewer, outsider].map((socket) => good(socket, 'room:hand', { raised: false })))
  assert.equal(forbiddenSignals, 0)
  await mutate(host, 'presentation:set', { source: 'slides' })
  await bad(viewer, 'rtc:ready')
  await bad(host, 'rtc:signal', { to: viewer.id, description: offer })
})
}

for (const demo of [false, true]) {
test(`host leave and disconnect ignore samples and transfer ownership to the earliest real attendee in ${demo ? 'demo' : 'real'} rooms`, testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, first, second] = await Promise.all([connect(), connect(), connect()])
  const initial = await join(host, 'transfer-room', '원래 진행자', demo)
  const samples = initial.participants.filter((participant) => participant.isDemo)
  await join(first, 'transfer-room', '첫 참가자', demo)
  await join(second, 'transfer-room', '둘째 참가자', demo)
  await mutate(host, 'presentation:set', { source: 'teams', slide: 2 })
  const hostId = host.id
  const [transferred] = await Promise.all([
    nextEvent(first, 'room:state', (room) => room.hostId === first.id),
    good(host, 'room:leave'),
  ])
  assert.equal(transferred.participants.some((participant) => participant.id === hostId), false)
  assert.equal(transferred.participants.find((participant) => participant.id === first.id)?.seat, null)
  assert.equal(transferred.participants.find((participant) => participant.id === transferred.hostId)?.isDemo, false)
  assert.deepEqual(transferred.participants.filter((participant) => participant.isDemo), samples)
  assert.deepEqual(transferred.presentation, { source: 'slides', slide: 2, presenterId: first.id })
  await bad(host, 'presentation:set', { source: 'screen' })
  await bad(second, 'room:title', { title: '아직 진행자가 아니에요' })
  await mutate(first, 'room:title', { title: '이어지는 만남' })
  await mutate(first, 'presentation:set', { source: 'screen' })
  const firstId = first.id
  const transfer = nextEvent(second, 'room:state', (room) => room.hostId === second.id)
  first.disconnect()
  const afterDisconnect = await transfer
  assert.equal(afterDisconnect.participants.some((participant) => participant.id === firstId), false)
  assert.equal(afterDisconnect.participants.find((participant) => participant.id === second.id)?.isDemo, false)
  assert.deepEqual(afterDisconnect.participants.filter((participant) => participant.isDemo), samples)
  assert.deepEqual(afterDisconnect.presentation, { source: 'slides', slide: 2, presenterId: second.id })
  assert.equal(afterDisconnect.title, '이어지는 만남')
})
}

for (const demo of [false, true]) {
test(`${demo ? 'demo' : 'real'} rooms seed eight sample attendees and three questions exactly once, and closing then recreating reseeds new IDs`, testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, replacement] = await Promise.all([connect(), connect(), connect()])
  const initial = await join(host, 'seed-room', '실제 진행자', demo)
  assert.equal(initial.isDemo, demo)
  assert.equal(initial.hostId, host.id)
  assert.equal(initial.presentation.presenterId, host.id)
  assert.equal(initial.participants.find((participant) => participant.id === initial.hostId)?.isDemo, false)
  assert.equal(initial.participants.filter((participant) => !participant.isDemo).length, 1)
  const bots = initial.participants.filter((participant) => participant.isDemo)
  assert.equal(bots.length, 8)
  assert.equal(initial.participants.length, bots.length + 1)
  assert.equal(new Set(bots.map((participant) => participant.name)).size, bots.length)
  assert.equal(new Set(bots.map((participant) => participant.avatar)).size, AVATARS.length)
  assert.deepEqual(bots.map((participant) => participant.seat), Array.from({ length: bots.length }, (_, index) => index))
  assert.ok(initial.participants.every((participant) => participant.seat !== 18))
  assert.equal(initial.questions.length, 3)
  for (const question of initial.questions) {
    assert.equal(question.isDemo, true)
    assert.match(question.text, /[가-힣]/)
    const author = bots.find((bot) => bot.id === question.authorId)
    assert.ok(author)
    assert.equal(question.authorName, author.name)
    assert.equal(question.avatar, author.avatar)
    assert.ok(question.votes.length >= 3 && question.votes.length <= 5)
    assert.ok(question.votes.every((id) => typeof id === 'string' && bots.some((bot) => bot.id === id)))
  }
  assert.match(await bad(viewer, 'room:join', { roomId: initial.id, name: '실제 참가자', avatar: 'sky', demo: !demo, role: 'attendee' }), /데모/)
  await bad(host, 'room:join', { roomId: initial.id, name: '진행자', avatar: 'mint', demo: !demo, role: 'host' })
  const rejoinedHost = await join(host, initial.id, '실제 진행자', demo)
  assert.equal(rejoinedHost.participants.filter((participant) => !participant.isDemo).length, 1)
  const attendeePayload = { roomId: initial.id, name: '실제 참가자', avatar: 'sky', demo, role: 'attendee' }
  const entered = await good<RoomJoinResult>(viewer, 'room:join', attendeePayload)
  assert.equal(entered.role, 'attendee')
  assert.equal(entered.participants.find((participant) => participant.id === viewer.id)?.seat, bots.length)
  const idempotentAttendee = await good<RoomJoinResult>(viewer, 'room:join', attendeePayload)
  assert.equal(idempotentAttendee.accessToken, entered.accessToken)
  await good(viewer, 'room:leave')
  const reentered = await good<RoomJoinResult>(viewer, 'room:join', attendeePayload)
  for (const room of [rejoinedHost, entered, idempotentAttendee, reentered]) {
    assert.equal(room.isDemo, demo)
    assert.equal(room.hostId, host.id)
    assert.deepEqual(room.participants.filter((participant) => participant.isDemo), bots)
    assert.deepEqual(room.questions, initial.questions)
  }
  for (const room of [entered, idempotentAttendee, reentered]) {
    assert.equal(room.participants.length, bots.length + 2)
    assert.equal(room.participants.filter((participant) => !participant.isDemo).length, 2)
  }

  const posted = await mutate(viewer, 'question:add', { text: '이 질문은 이 만남에만 남아야 해요.' })
  const liveQuestion = posted.questions.find((question) => !question.isDemo)
  assert.ok(liveQuestion)
  assert.deepEqual((await join(host, initial.id, '실제 진행자', demo)).questions, posted.questions)
  await mutate(host, 'presentation:set', { source: 'screen' })
  await bad(host, 'rtc:signal', { to: bots[0].id, candidate: { candidate: '' } })

  const viewerId = viewer.id
  const [withoutViewer] = await Promise.all([
    nextEvent(host, 'room:state', (room) => !room.participants.some((participant) => participant.id === viewerId)),
    good(viewer, 'room:leave'),
  ])
  assert.equal(withoutViewer.presentation.source, 'screen')
  assert.deepEqual(withoutViewer.participants.filter((participant) => participant.isDemo), bots)
  assert.equal(withoutViewer.participants.filter((participant) => !participant.isDemo).length, 1)
  await good(host, 'room:leave')
  assert.match(await bad(replacement, 'room:join', attendeePayload), /열리지|종료/)
  const fresh = await join(replacement, initial.id, '새로운 진행자', !demo)
  assert.equal(fresh.isDemo, !demo)
  assert.equal(fresh.hostId, replacement.id)
  assert.equal(fresh.participants.find((participant) => participant.id === fresh.hostId)?.isDemo, false)
  assert.equal(fresh.participants.filter((participant) => !participant.isDemo).length, 1)
  assert.equal(fresh.participants.filter((participant) => participant.isDemo).length, bots.length)
  assert.equal(fresh.participants.length, bots.length + 1)
  assert.ok(fresh.participants.every((participant) => !initial.participants.some((entry) => entry.id === participant.id)))
  assert.equal(fresh.questions.length, initial.questions.length)
  assert.ok(fresh.questions.every((question) => question.isDemo && !posted.questions.some((entry) => entry.id === question.id)))
  assert.ok(fresh.questions.every((question) => fresh.participants.some((participant) => participant.isDemo && participant.id === question.authorId)))
})
}

for (const demo of [false, true]) {
test(`combined sample and live capacity never exceeds 25 in ${demo ? 'demo' : 'real'} rooms, and a failed join preserves old membership`, testOptions, async (t) => {
  const { connect } = await fixture(t)
  const host = await connect()
  const initial = await join(host, 'capacity-room', '진행자', demo)
  const samples = initial.participants.filter((participant) => participant.isDemo)
  const viewers = await Promise.all(Array.from({ length: SEAT_COUNT - samples.length }, () => connect()))
  for (const [index, viewer] of viewers.entries()) {
    const room = await join(viewer, 'capacity-room', `참가자${index}`, demo)
    assert.equal(room.participants.find((participant) => participant.id === viewer.id)?.seat, index + samples.length)
  }
  const full = latest(viewers[viewers.length - 1])
  assert.equal(full.participants.length, SEAT_COUNT + 1)
  assert.equal(full.participants.filter((participant) => !participant.isDemo).length, 17)
  assert.deepEqual(full.participants.filter((participant) => participant.isDemo), samples)
  assert.equal(new Set(full.participants.filter((participant) => participant.seat !== null).map((participant) => participant.seat)).size, SEAT_COUNT)
  const outsider = await connect()
  await join(outsider, 'capacity-outside')
  assert.match(await bad(outsider, 'room:join', { roomId: 'capacity-room', name: '늦은 참가자', avatar: 'mint', demo, role: 'attendee' }), /가득/)
  assert.equal((await mutate(outsider, 'room:title', { title: '원래 방에 남아 있어요' })).id, 'capacity-outside')
  await good(viewers[4], 'room:leave')
  const admitted = await join(outsider, 'capacity-room', '늦은 참가자', demo)
  assert.equal(admitted.participants.length, SEAT_COUNT + 1)
  assert.deepEqual(admitted.participants.filter((participant) => participant.isDemo), samples)
  assert.equal(admitted.participants.find((participant) => participant.id === outsider.id)?.seat, samples.length + 4)
  await bad(outsider, 'room:title', { title: '다른 방의 권한을 가져올 수 없어요' })
})
}

test('the question cap is explicit at 100 without evicting questions or treating answers as deletions', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const writers = await Promise.all(Array.from({ length: 10 }, () => connect()))
  for (const [index, writer] of writers.entries()) await join(writer, 'question-cap', `작성자${index}`)
  const samples = latest(writers[0]).questions
  const remainingCapacity = 100 - samples.length
  for (let start = 0; start < remainingCapacity; start += writers.length) {
    await Promise.all(writers.slice(0, remainingCapacity - start).map((writer, index) => good(writer, 'question:add', { text: `협업 아이디어 ${start + index}` })))
  }
  let room = await mutate(writers[0], 'room:hand', { raised: false })
  assert.equal(room.questions.length, 100)
  assert.equal(new Set(room.questions.map((question) => question.id)).size, 100)
  assert.deepEqual(room.questions.filter((question) => question.isDemo), samples)
  assert.match(await bad(writers[0], 'question:add', { text: '101번째 질문' }), /100/)
  const liveQuestion = room.questions.find((question) => !question.isDemo)
  assert.ok(liveQuestion)
  room = await mutate(writers[0], 'question:answer', { questionId: liveQuestion.id })
  assert.equal(room.questions.length, 100)
  assert.match(await bad(writers[0], 'question:add', { text: '답변 이후에도 질문은 남아요' }), /100/)
})

test('room switches release old membership and host privileges without cross-room author or vote mutations', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [mover, remaining, destinationHost] = await Promise.all([connect(), connect(), connect()])
  await join(mover, 'switch-old', '원래 이름')
  await join(remaining, 'switch-old')
  const destination = await join(destinationHost, 'switch-new')
  const question = (await mutate(mover, 'question:add', { text: '이 질문은 원래 방에 남아요.' })).questions.find((entry) => !entry.isDemo)
  assert.ok(question)
  const questionId = question.id
  await mutate(mover, 'question:vote', { questionId })
  await mutate(mover, 'presentation:set', { source: 'screen' })
  const [oldRoom, newRoom] = await Promise.all([
    nextEvent(remaining, 'room:state', (room) => room.hostId === remaining.id),
    join(mover, 'switch-new', '새 방 이름'),
  ])
  assert.equal(oldRoom.participants.some((participant) => participant.id === mover.id), false)
  assert.deepEqual(oldRoom.questions.find((entry) => entry.id === questionId)?.votes, [])
  assert.equal(oldRoom.presentation.source, 'slides')
  assert.equal(newRoom.hostId, destinationHost.id)
  assert.equal(newRoom.participants.find((participant) => participant.id === mover.id)?.seat, destination.participants.filter((participant) => participant.isDemo).length)
  await bad(mover, 'room:title', { title: '옛 진행자 권한은 사라져요' })
  await bad(mover, 'question:vote', { questionId })
  await mutate(mover, 'room:profile', { name: '새로운 프로필', avatar: 'peach' })
  assert.equal((await mutate(remaining, 'room:hand', { raised: false })).questions.find((entry) => entry.id === questionId)?.authorName, '원래 이름')
  let leakedStates = 0
  mover.on('room:state', (room) => { if (room.id === 'switch-old') leakedStates += 1 })
  await mutate(remaining, 'room:title', { title: '옛 방의 새 진행자' })
  await mutate(mover, 'room:hand', { raised: false })
  assert.equal(leakedStates, 0)
})

test('room count is bounded and emptied rooms free capacity, including direct room switches', testOptions, async (t) => {
  const { connect } = await fixture(t, { maxRooms: 2 })
  const [first, second, third] = await Promise.all([connect(), connect(), connect()])
  await join(first, 'limit-first')
  await join(second, 'limit-second')
  assert.match(await bad(third, 'room:join', { roomId: 'limit-third', name: '참가자', avatar: 'mint', demo: false, role: 'host' }), /너무 많/)
  await bad(third, 'room:title', { title: '입장 실패 후에는 권한이 없어요' })
  assert.equal((await join(first, 'limit-third')).id, 'limit-third')
  await good(second, 'room:leave')
  assert.equal((await join(third, 'limit-first')).hostId, third.id)
})

test('explicit entry roles and room-scoped original materials enforce host writes and attendee reads', testOptions, async (t) => {
  const { url, connect } = await fixture(t)
  const [host, attendee, outsider] = await Promise.all([connect(), connect(), connect()])
  const profile = { name: '자료 호스트', avatar: 'mint', demo: false, roomId: 'material-room' }
  assert.match(await bad(attendee, 'room:join', { ...profile, role: 'attendee' }), /열리지/)
  const created = await good<RoomJoinResult>(host, 'room:join', { ...profile, role: 'host', title: '자료 기반 미팅' })
  const joined = await good<RoomJoinResult>(attendee, 'room:join', { ...profile, role: 'attendee' })
  const other = await good<RoomJoinResult>(outsider, 'room:join', { ...profile, roomId: 'other-material-room', role: 'host' })
  assert.equal(created.role, 'host')
  assert.equal(joined.role, 'attendee')
  assert.equal(created.title, '자료 기반 미팅')
  assert.equal('accessToken' in latest(attendee), false)
  const endpoint = `${url}/api/rooms/material-room/materials`
  assert.equal((await fetch(endpoint)).status, 401)
  assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${other.accessToken}` } })).status, 401)
  const requestUpload = (token: string, name: string, body: string) => fetch(`${endpoint}?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body,
  })
  assert.equal((await requestUpload(joined.accessToken, 'notes.txt', 'attendee upload')).status, 403)
  assert.equal((await requestUpload(created.accessToken, 'bad.exe', 'bad')).status, 400)
  assert.equal((await requestUpload(created.accessToken, 'fake.pdf', 'not a PDF')).status, 400)
  const content = '팀원의 에이전트가 읽을 발표 자료'
  const uploaded = await requestUpload(created.accessToken, '발표.txt', content)
  assert.equal(uploaded.status, 201)
  const material = await uploaded.json()
  assert.equal(material.name, '발표.txt')
  assert.equal(material.sha256.length, 64)
  const listing = await fetch(endpoint, { headers: { Authorization: `Bearer ${joined.accessToken}` } })
  assert.equal((await listing.json()).materials.length, 1)
  const downloaded = await fetch(`${url}${material.contentUrl}`, { headers: { Authorization: `Bearer ${joined.accessToken}` } })
  assert.equal(await downloaded.text(), content)
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff')
  assert.match(downloaded.headers.get('content-disposition') ?? '', /attachment/)
  await good(attendee, 'room:leave')
  assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${joined.accessToken}` } })).status, 401)
})

test('room:context is host-only, is never part of any broadcast room:state, and feeds the AI assistant privately', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer] = await Promise.all([connect(), connect()])
  await join(host, 'context-room')
  await join(viewer, 'context-room')
  assert.match(await bad(viewer, 'room:context', { context: '권한 없는 변경' }), /진행자/)

  const [, room] = await Promise.all([
    noEvent(viewer, 'room:state'),
    good(host, 'room:context', { context: '발표 자료: 오늘의 주제는 협업입니다.' }),
  ])
  assert.equal(room, undefined)
  // Defence in depth: even a future regression that re-adds a `context` field to
  // RoomSnapshot server-side should be caught here, not just by the TS type.
  assert.doesNotMatch(JSON.stringify(latest(host)), /오늘의 주제는 협업입니다/)

  // Trims and allows clearing back to an empty string (distinct from unset/never-set).
  await good(host, 'room:context', { context: '   ' })
})

test('the AI assistant answers privately from the room context without broadcasting to other participants', testOptions, async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let capturedBody: { messages: { role: string; content: string }[] } | undefined
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string)
    return new Response(JSON.stringify({ choices: [{ message: { content: '협업을 주제로 다룹니다.' } }] }), { status: 200 })
  }) as typeof fetch
  process.env.AI_API_KEY = 'test-key'
  t.after(() => { delete process.env.AI_API_KEY })

  const { connect } = await fixture(t)
  const [host, viewer] = await Promise.all([connect(), connect()])
  await join(host, 'ai-room')
  await join(viewer, 'ai-room')
  await good(host, 'room:context', { context: '오늘 발표 주제는 협업입니다.' })

  const [reply] = await Promise.all([
    good<{ answer: string }>(viewer, 'ai:ask', { question: '오늘 주제가 뭐예요?' }),
    noEvent(host, 'room:state'),
  ])
  assert.equal(reply.answer, '협업을 주제로 다룹니다.')
  assert.match(capturedBody?.messages[0].content ?? '', /오늘 발표 주제는 협업입니다\./)
  assert.deepEqual(capturedBody?.messages[1], { role: 'user', content: '오늘 주제가 뭐예요?' })

  await bad(viewer, 'ai:ask', { question: '' })
  await bad(viewer, 'ai:ask', { question: '💡'.repeat(501) })
})

test('the AI assistant never leaks an unexpected internal error message to the client', testOptions, async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = (() => { throw new TypeError('internal stack trace detail: /var/secret/path.ts:42') }) as unknown as typeof fetch
  process.env.AI_API_KEY = 'test-key'
  t.after(() => { delete process.env.AI_API_KEY })

  const { connect } = await fixture(t)
  const viewer = await connect()
  await join(viewer, 'ai-error-room')
  const error = await bad(viewer, 'ai:ask', { question: '아무거나 물어볼게요' })
  assert.doesNotMatch(error, /internal stack trace|secret|TypeError/)
})
