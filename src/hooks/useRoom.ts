import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { emitWithAck, errorMessage } from '../lib/socket.ts'
import type {
  Ack,
  AvatarColor,
  ClientToServerEvents,
  Reaction,
  ReactionEmoji,
  RoomSnapshot,
  ServerToClientEvents,
} from '../shared/protocol.ts'

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'
export interface RoomTarget { id: string; demo: boolean }
export interface Profile { name: string; avatar: AvatarColor }

export function useRoom(target: RoomTarget | null, initialProfile: Profile) {
  const [socket] = useState<RoomSocket>(() =>
    io({ autoConnect: false, timeout: 8_000, transports: ['websocket', 'polling'] }),
  )
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [myId, setMyId] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const profileRef = useRef(initialProfile)
  const roomId = target?.id
  const demo = target?.demo ?? false

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      setStatus('disconnected')
      return
    }

    let active = true
    setRoom(null)
    setReactions([])
    setStatus('connecting')

    const onConnect = async () => {
      try {
        const joinedRoom = await emitWithAck<RoomSnapshot>((ack) =>
          socket.emit('room:join', { roomId, demo, ...profileRef.current }, ack),
        )
        if (!active) return
        setMyId(socket.id ?? '')
        setRoom(joinedRoom)
        setStatus('connected')
        setError(null)
      } catch (joinError) {
        if (!active) return
        setStatus('failed')
        setError(errorMessage(joinError))
        socket.disconnect()
      }
    }
    const onState = (snapshot: RoomSnapshot) => {
      if (active && snapshot.id === roomId) setRoom(snapshot)
    }
    const onReaction = (reaction: Reaction) => {
      setReactions((previous) => [...previous.slice(-23), reaction])
    }
    const onDisconnect = () => {
      if (active) setStatus('disconnected')
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
  }, [socket, roomId, demo])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - 4_000
      setReactions((previous) => {
        if (!previous.some((reaction) => reaction.createdAt < cutoff)) return previous
        return previous.filter((reaction) => reaction.createdAt >= cutoff)
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
    socket, room, myId, status, error, reactions, actions,
    reportError: setError,
    clearError: () => setError(null),
  }
}

export type RoomActions = ReturnType<typeof useRoom>['actions']
