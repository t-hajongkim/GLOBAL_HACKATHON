import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { emitWithAck, errorMessage } from '../lib/socket.ts'
import type {
  Ack,
  AvatarColor,
  ClientToServerEvents,
  JoinRole,
  Reaction,
  ReactionEmoji,
  RoomSnapshot,
  RoomJoinResult,
  ServerToClientEvents,
} from '../shared/protocol.ts'

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'
export interface RoomTarget { id: string; demo: boolean; role: JoinRole; title?: string; attempt?: number }
export interface Profile { name: string; avatar: AvatarColor }
export interface QuestionBubble { id: string; participantId: string; text: string; shownAt: number }

export function useRoom(target: RoomTarget | null, initialProfile: Profile) {
  const [socket] = useState<RoomSocket>(() =>
    io({ autoConnect: false, timeout: 8_000, transports: ['websocket', 'polling'] }),
  )
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [myId, setMyId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [questionBubbles, setQuestionBubbles] = useState<QuestionBubble[]>([])
  const profileRef = useRef(initialProfile)
  const roomId = target?.id
  const demo = target?.demo ?? false
  const role = target?.role ?? 'attendee'
  const title = target?.title
  const attempt = target?.attempt

  useEffect(() => { profileRef.current = initialProfile }, [initialProfile])

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      setAccessToken('')
      setQuestionBubbles([])
      setStatus('disconnected')
      return
    }

    let active = true
    let knownQuestionIds: Set<string> | null = null
    setRoom(null)
    setAccessToken('')
    setReactions([])
    setQuestionBubbles([])
    setStatus('connecting')

    const onConnect = async () => {
      try {
        const joinedRoom = await emitWithAck<RoomJoinResult>((ack) =>
          socket.emit('room:join', { roomId, demo, role, title, ...profileRef.current }, ack),
        )
        if (!active) return
        setMyId(socket.id ?? '')
        const { accessToken: token, role: actualRole, ...snapshot } = joinedRoom
        knownQuestionIds ??= new Set(snapshot.questions.map((question) => question.id))
        setRoom(snapshot)
        setAccessToken(token)
        setStatus('connected')
        setError(role === 'host' && actualRole !== 'host'
          ? '이미 Host가 있는 방이어서 Attendee로 입장했어요.' : null)
      } catch (joinError) {
        if (!active) return
        setStatus('failed')
        setError(errorMessage(joinError))
        socket.disconnect()
      }
    }
    const onState = (snapshot: RoomSnapshot) => {
      if (!active || snapshot.id !== roomId) return
      const seen = knownQuestionIds
      const added = seen ? snapshot.questions.filter((question) => !question.isDemo && !seen.has(question.id)) : []
      knownQuestionIds = new Set(snapshot.questions.map((question) => question.id))
      if (added.length > 0) {
        const shownAt = Date.now()
        setQuestionBubbles((previous) => {
          const byParticipant = new Map(previous.map((bubble) => [bubble.participantId, bubble]))
          for (const question of added) {
            byParticipant.set(question.authorId, {
              id: question.id, participantId: question.authorId, text: question.text, shownAt,
            })
          }
          return [...byParticipant.values()]
        })
      }
      setRoom(snapshot)
    }
    const onReaction = (reaction: Reaction) => {
      setReactions((previous) => [...previous.slice(-23), reaction])
    }
    const onDisconnect = () => {
      if (active) {
        knownQuestionIds = null
        setQuestionBubbles([])
        setStatus('disconnected')
        setAccessToken('')
      }
    }
    const onConnectError = () => {
      if (active) {
        setStatus('disconnected')
        setError('미팅 서버에 연결하지 못했어요. 자동으로 다시 연결하고 있습니다.')
      }
    }

    socket.on('connect', onConnect)
    socket.on('room:state', onState)
    socket.on('room:reaction', onReaction)
    socket.on('room:error', setError)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.connect()

    return () => {
      active = false
      socket.off('connect', onConnect)
      socket.off('room:state', onState)
      socket.off('room:reaction', onReaction)
      socket.off('room:error', setError)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.disconnect()
    }
  }, [socket, roomId, demo, role, title, attempt])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 4_000
      setReactions((previous) => {
        if (!previous.some((reaction) => reaction.createdAt < cutoff)) return previous
        return previous.filter((reaction) => reaction.createdAt >= cutoff)
      })
      const questionCutoff = Date.now() - 12_000
      setQuestionBubbles((previous) => {
        if (!previous.some((bubble) => bubble.shownAt <= questionCutoff)) return previous
        return previous.filter((bubble) => bubble.shownAt > questionCutoff)
      })
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [])

  const command = useCallback(async (emit: (ack: Ack) => void) => {
    if (!socket.connected) {
      setError('연결이 끊어졌어요. 다시 연결되면 시도해 주세요.')
      return false
    }
    try {
      await emitWithAck(emit)
      return true
    } catch (commandError) {
      setError(errorMessage(commandError))
      return false
    }
  }, [socket])

  const actions = useMemo(() => ({
    seat: (seat: number) => command((ack) => socket.emit('room:seat', { seat }, ack)),
    move: (x: number, y: number) => command((ack) => socket.emit('room:move', { x, y }, ack)),
    hand: (raised: boolean) => command((ack) => socket.emit('room:hand', { raised }, ack)),
    react: (emoji: ReactionEmoji) => command((ack) => socket.emit('room:reaction', { emoji }, ack)),
    question: (text: string) => command((ack) => socket.emit('question:add', { text }, ack)),
    vote: (questionId: string) => command((ack) => socket.emit('question:vote', { questionId }, ack)),
    answer: (questionId: string) => command((ack) => socket.emit('question:answer', { questionId }, ack)),
    slide: (slide: number) => command((ack) =>
      socket.emit('presentation:set', { slide, source: 'slides' }, ack)),
    title: (title: string) => command((ack) => socket.emit('room:title', { title }, ack)),
    profile: async (profile: Profile) => {
      const success = await command((ack) => socket.emit('room:profile', profile, ack))
      if (success) profileRef.current = profile
      return success
    },
  }), [command, socket])

  return {
    socket, room, myId, accessToken, status, error, reactions, questionBubbles, actions,
    reportError: setError,
    clearError: () => setError(null),
  }
}

export type RoomActions = ReturnType<typeof useRoom>['actions']
