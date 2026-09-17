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
  const room = await good<RoomSnapshot>(socket, 'room:join', {
    roomId, name, avatar: 'mint', demo,
  })
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

test('joining creates isolated real rooms, trims Unicode profiles, and is idempotent', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, outsider, unjoined] = await Promise.all([connect(), connect(), connect(), connect()])
  const first = await join(host, 'room-alpha', '  민트  ')
  assert.equal(first.id, 'room-alpha')
  assert.equal(first.hostId, host.id)
  assert.equal(first.title, DEFAULT_ROOM_TITLE)
  assert.equal(first.isDemo, false)
  assert.equal(first.participants.length, 1)
  assert.deepEqual(first.presentation, { source: 'slides', slide: 0, presenterId: host.id })
  assert.equal(first.participants[0].name, '민트')
  assert.equal(first.participants[0].seat, null)
  assert.equal(first.participants[0].isDemo, false)
  assert.deepEqual(first.questions, [])

  const second = await join(viewer, 'room-alpha', '💡'.repeat(20))
  assert.equal(second.hostId, host.id)
  assert.equal(second.participants.find((participant) => participant.id === viewer.id)?.seat, 0)
  const other = await join(outsider, 'room-beta')
  assert.equal(other.hostId, outsider.id)
  assert.deepEqual(other.participants.map((participant) => participant.id), [outsider.id])
  await bad(unjoined, 'room:hand', { raised: true })
  await bad(unjoined, 'room:reaction', { emoji: '👏' })
  await bad(unjoined, 'question:add', { text: '아직 입장하지 않았어요.' })

  const updated = await join(viewer, 'room-alpha', '  새 이름  ')
  assert.equal(updated.participants.length, 2)
  assert.equal(updated.participants.find((participant) => participant.id === viewer.id)?.seat, 0)
  assert.equal(updated.participants.find((participant) => participant.id === viewer.id)?.name, '새 이름')
  const outsideStates: RoomSnapshot[] = []
  outsider.on('room:state', (room) => outsideStates.push(room))
  await Promise.all([
    nextEvent(host, 'room:state', (room) => room.participants.some((participant) => participant.id === viewer.id && participant.handRaised)),
    good(viewer, 'room:hand', { raised: true }),
  ])
  await mutate(outsider, 'room:hand', { raised: false })
  assert.ok(outsideStates.every((room) => room.id === 'room-beta'))
  assert.equal(latest(outsider).participants.length, 1)
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
  await join(host, 'seat-room')
  await join(first, 'seat-room')
  await join(second, 'seat-room')
  assert.equal((await mutate(host, 'room:seat', { seat: 5 })).participants.find((participant) => participant.id === host.id)?.seat, 5)
  assert.match(await bad(first, 'room:seat', { seat: 5 }), /자리/)

  const results = await Promise.all([
    request(first, 'room:seat', { seat: 3 }),
    request(second, 'room:seat', { seat: 3 }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  const winner = results[0].ok ? first : second
  const loser = results[0].ok ? second : first
  const winnerId = winner.id
  const occupied = await mutate(host, 'room:hand', { raised: false })
  assert.equal(occupied.participants.filter((participant) => participant.seat === 3).length, 1)
  const seats = occupied.participants.map((participant) => participant.seat)
  assert.equal(new Set(seats).size, seats.length)

  await Promise.all([
    nextEvent(host, 'room:state', (room) => !room.participants.some((participant) => participant.id === winnerId)),
    good(winner, 'room:leave'),
  ])
  await bad(winner, 'room:hand', { raised: true })
  const released = await mutate(loser, 'room:seat', { seat: 3 })
  assert.equal(released.participants.find((participant) => participant.id === loser.id)?.seat, 3)
  const arrived = await join(newcomer, 'seat-room')
  assert.equal(arrived.participants.find((participant) => participant.id === newcomer.id)?.seat, 0)
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
  await join(host, 'question-room', '진행자')
  await join(author, 'question-room', '처음 이름')
  let room = await mutate(author, 'question:add', { text: '  첫 아이디어를 함께 키울까요? \n' })
  const questionId = room.questions[0].id
  assert.equal(room.questions[0].text, '첫 아이디어를 함께 키울까요?')
  assert.equal(room.questions[0].authorId, author.id)
  assert.equal(room.questions[0].authorName, '처음 이름')
  assert.equal(room.questions[0].isDemo, false)
  assert.equal(room.questions[0].answered, false)
  assert.deepEqual(room.questions[0].votes, [])
  room = await mutate(author, 'question:add', { text: '💡'.repeat(MAX_QUESTION_LENGTH) })
  assert.equal(Array.from(room.questions[1].text).length, MAX_QUESTION_LENGTH)
  await bad(author, 'question:add', { text: '💡'.repeat(MAX_QUESTION_LENGTH + 1) })
  await bad(author, 'question:add', { text: ' \n\t ' })

  room = await mutate(author, 'room:profile', { name: '  유나  ', avatar: 'rose' })
  assert.equal(room.participants.find((participant) => participant.id === author.id)?.name, '유나')
  assert.ok(room.questions.every((question) => question.authorName === '유나' && question.avatar === 'rose'))
  room = await mutate(host, 'question:vote', { questionId })
  assert.deepEqual(room.questions[0].votes, [host.id])
  room = await mutate(host, 'question:vote', { questionId })
  assert.deepEqual(room.questions[0].votes, [])
  await mutate(host, 'question:vote', { questionId })
  room = await mutate(author, 'question:vote', { questionId })
  assert.deepEqual(new Set(room.questions[0].votes), new Set([host.id, author.id]))
  await bad(host, 'question:vote', { questionId: 'does-not-exist' })
  await bad(host, 'question:answer', { questionId: 'does-not-exist' })
  const authorId = author.id
  const [remaining] = await Promise.all([
    nextEvent(host, 'room:state', (state) => !state.participants.some((participant) => participant.id === authorId)),
    good(author, 'room:leave'),
  ])
  assert.deepEqual(remaining.questions[0].votes, [host.id])
  assert.equal(remaining.questions[0].authorName, '유나')
  assert.equal(remaining.questions.length, 2)
})

test('only the host controls answered status, title, and bounded slides without implicit screen stopping', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer] = await Promise.all([connect(), connect()])
  await join(host, 'presentation-room')
  await join(viewer, 'presentation-room')
  const questionId = (await mutate(viewer, 'question:add', { text: '함께 어떤 실험을 해 볼까요?' })).questions[0].id
  for (const [event, payload] of [
    ['question:answer', { questionId }],
    ['room:title', { title: '권한 없는 변경' }],
    ['presentation:set', { source: 'screen', slide: 1 }],
    ['presentation:set', { source: 'teams', slide: 1 }],
  ] as [ClientEvent, unknown][]) {
    assert.match(await bad(viewer, event, payload), /진행자/)
  }

  assert.equal((await mutate(host, 'question:answer', { questionId })).questions[0].answered, true)
  assert.equal((await mutate(host, 'question:answer', { questionId })).questions[0].answered, false)
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

test('host leave and disconnect transfer ownership to the earliest real attendee and end screen sharing', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, first, second] = await Promise.all([connect(), connect(), connect()])
  await join(host, 'transfer-room', '원래 진행자', true)
  await join(first, 'transfer-room', '첫 참가자', true)
  await join(second, 'transfer-room', '둘째 참가자', true)
  await mutate(host, 'presentation:set', { source: 'teams', slide: 2 })
  const hostId = host.id
  const [transferred] = await Promise.all([
    nextEvent(first, 'room:state', (room) => room.hostId === first.id),
    good(host, 'room:leave'),
  ])
  assert.equal(transferred.participants.some((participant) => participant.id === hostId), false)
  assert.equal(transferred.participants.find((participant) => participant.id === first.id)?.seat, null)
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
  assert.deepEqual(afterDisconnect.presentation, { source: 'slides', slide: 2, presenterId: second.id })
  assert.equal(afterDisconnect.title, '이어지는 만남')
})

test('demo seeds are explicit and bounded, status cannot change, and the last real departure deletes bots too', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer, replacement] = await Promise.all([connect(), connect(), connect()])
  const demo = await join(host, 'demo-room', '실제 진행자', true)
  assert.equal(demo.hostId, host.id)
  const bots = demo.participants.filter((participant) => participant.isDemo)
  assert.equal(bots.length, 10)
  assert.equal(new Set(bots.map((participant) => participant.avatar)).size, AVATARS.length)
  assert.deepEqual(bots.map((participant) => participant.seat), Array.from({ length: 10 }, (_, index) => index))
  assert.equal(demo.questions.length, 3)
  for (const question of demo.questions) {
    assert.equal(question.isDemo, true)
    assert.match(question.text, /[가-힣]/)
    assert.ok(bots.some((bot) => bot.id === question.authorId))
    assert.ok(question.votes.length >= 3 && question.votes.length <= 5)
    assert.ok(question.votes.every((id) => typeof id === 'string' && bots.some((bot) => bot.id === id)))
  }
  assert.match(await bad(viewer, 'room:join', { roomId: 'demo-room', name: '실제 참가자', avatar: 'sky', demo: false }), /데모/)
  await bad(host, 'room:join', { roomId: 'demo-room', name: '진행자', avatar: 'mint', demo: false })
  assert.equal((await join(viewer, 'demo-room', '실제 참가자', true)).participants.find((participant) => participant.id === viewer.id)?.seat, 10)
  await mutate(host, 'presentation:set', { source: 'screen' })
  await bad(host, 'rtc:signal', { to: bots[0].id, candidate: { candidate: '' } })

  const viewerId = viewer.id
  const [withoutViewer] = await Promise.all([
    nextEvent(host, 'room:state', (room) => !room.participants.some((participant) => participant.id === viewerId)),
    good(viewer, 'room:leave'),
  ])
  assert.equal(withoutViewer.presentation.source, 'screen')
  await good(host, 'room:leave')
  const fresh = await join(replacement, 'demo-room', '새로운 진행자')
  assert.equal(fresh.isDemo, false)
  assert.equal(fresh.hostId, replacement.id)
  assert.equal(fresh.participants.length, 1)
  assert.deepEqual(fresh.questions, [])
})

test('combined demo and live capacity never exceeds 25 and a failed full-room join preserves old membership', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const host = await connect()
  await join(host, 'capacity-room', '진행자', true)
  const viewers = await Promise.all(Array.from({ length: 14 }, () => connect()))
  for (const [index, viewer] of viewers.entries()) {
    const room = await join(viewer, 'capacity-room', `참가자${index}`, true)
    assert.equal(room.participants.find((participant) => participant.id === viewer.id)?.seat, index + 10)
  }
  const full = latest(viewers[13])
  assert.equal(full.participants.length, SEAT_COUNT + 1)
  assert.equal(new Set(full.participants.filter((participant) => participant.seat !== null).map((participant) => participant.seat)).size, SEAT_COUNT)
  const outsider = await connect()
  await join(outsider, 'capacity-outside')
  assert.match(await bad(outsider, 'room:join', { roomId: 'capacity-room', name: '늦은 참가자', avatar: 'mint', demo: true }), /가득/)
  assert.equal((await mutate(outsider, 'room:title', { title: '원래 방에 남아 있어요' })).id, 'capacity-outside')
  await good(viewers[4], 'room:leave')
  const admitted = await join(outsider, 'capacity-room', '늦은 참가자', true)
  assert.equal(admitted.participants.length, SEAT_COUNT + 1)
  assert.equal(admitted.participants.find((participant) => participant.id === outsider.id)?.seat, 14)
  await bad(outsider, 'room:title', { title: '다른 방의 권한을 가져올 수 없어요' })
})

test('the question cap is explicit at 100 without evicting questions or treating answers as deletions', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const writers = await Promise.all(Array.from({ length: 10 }, () => connect()))
  for (const [index, writer] of writers.entries()) await join(writer, 'question-cap', `작성자${index}`)
  for (let question = 0; question < 10; question += 1) {
    await Promise.all(writers.map((writer, index) => good(writer, 'question:add', { text: `협업 아이디어 ${index}-${question}` })))
  }
  let room = await mutate(writers[0], 'room:hand', { raised: false })
  assert.equal(room.questions.length, 100)
  assert.equal(new Set(room.questions.map((question) => question.id)).size, 100)
  assert.match(await bad(writers[0], 'question:add', { text: '101번째 질문' }), /100/)
  room = await mutate(writers[0], 'question:answer', { questionId: room.questions[0].id })
  assert.equal(room.questions.length, 100)
  assert.match(await bad(writers[0], 'question:add', { text: '답변 이후에도 질문은 남아요' }), /100/)
})

test('room switches release old membership and host privileges without cross-room author or vote mutations', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [mover, remaining, destinationHost] = await Promise.all([connect(), connect(), connect()])
  await join(mover, 'switch-old', '원래 이름')
  await join(remaining, 'switch-old')
  await join(destinationHost, 'switch-new')
  const questionId = (await mutate(mover, 'question:add', { text: '이 질문은 원래 방에 남아요.' })).questions[0].id
  await mutate(mover, 'question:vote', { questionId })
  await mutate(mover, 'presentation:set', { source: 'screen' })
  const [oldRoom, newRoom] = await Promise.all([
    nextEvent(remaining, 'room:state', (room) => room.hostId === remaining.id),
    join(mover, 'switch-new', '새 방 이름'),
  ])
  assert.equal(oldRoom.participants.some((participant) => participant.id === mover.id), false)
  assert.deepEqual(oldRoom.questions[0].votes, [])
  assert.equal(oldRoom.presentation.source, 'slides')
  assert.equal(newRoom.hostId, destinationHost.id)
  assert.equal(newRoom.participants.find((participant) => participant.id === mover.id)?.seat, 0)
  await bad(mover, 'room:title', { title: '옛 진행자 권한은 사라져요' })
  await bad(mover, 'question:vote', { questionId })
  await mutate(mover, 'room:profile', { name: '새로운 프로필', avatar: 'peach' })
  assert.equal((await mutate(remaining, 'room:hand', { raised: false })).questions[0].authorName, '원래 이름')
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
  assert.match(await bad(third, 'room:join', { roomId: 'limit-third', name: '참가자', avatar: 'mint', demo: false }), /너무 많/)
  await bad(third, 'room:title', { title: '입장 실패 후에는 권한이 없어요' })
  assert.equal((await join(first, 'limit-third')).id, 'limit-third')
  await good(second, 'room:leave')
  assert.equal((await join(third, 'limit-first')).hostId, third.id)
  await good(second, 'room:leave')
})

test('rooms start with empty AI context, only the host can set it, and it is broadcast to everyone', testOptions, async (t) => {
  const { connect } = await fixture(t)
  const [host, viewer] = await Promise.all([connect(), connect()])
  const joined = await join(host, 'context-room')
  assert.equal(joined.context, '')
  await join(viewer, 'context-room')
  assert.match(await bad(viewer, 'room:context', { context: '권한 없는 변경' }), /진행자/)
  const [viewerState, room] = await Promise.all([
    nextEvent(viewer, 'room:state', (state) => state.context === '발표 자료: 오늘의 주제는 협업입니다.'),
    mutate(host, 'room:context', { context: '발표 자료: 오늘의 주제는 협업입니다.' }),
  ])
  assert.equal(room.context, '발표 자료: 오늘의 주제는 협업입니다.')
  assert.equal(viewerState.context, '발표 자료: 오늘의 주제는 협업입니다.')
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
  await mutate(host, 'room:context', { context: '오늘 발표 주제는 협업입니다.' })

  const noBroadcast = new Promise<string>((resolve) => {
    const onState = () => resolve('broadcast')
    host.once('room:state', onState)
    setTimeout(() => { host.off('room:state', onState); resolve('timeout') }, 300)
  })
  const reply = await good<{ answer: string }>(viewer, 'ai:ask', { question: '오늘 주제가 뭐예요?' })
  assert.equal(reply.answer, '협업을 주제로 다룹니다.')
  assert.equal(await noBroadcast, 'timeout')
  assert.match(capturedBody?.messages[0].content ?? '', /오늘 발표 주제는 협업입니다\./)
  assert.deepEqual(capturedBody?.messages[1], { role: 'user', content: '오늘 주제가 뭐예요?' })

  await bad(viewer, 'ai:ask', { question: '' })
  await bad(viewer, 'ai:ask', { question: '💡'.repeat(501) })
})
