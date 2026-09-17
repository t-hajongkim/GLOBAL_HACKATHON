import { useCallback, useRef, useState } from 'react'
import { emitWithAck, errorMessage } from '../lib/socket.ts'
import { MAX_AI_QUESTION_LENGTH } from '../shared/protocol.ts'
import type { RoomSocket } from './useRoom.ts'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

// LLM round-trips run well past the default emitWithAck timeout (7s), so this
// hook passes its own, longer timeout through to the shared helper.
const ASK_TIMEOUT_MS = 25_000

// Kept private to this browser tab only (per-attendee, never broadcast or persisted).
export function useAiChat(socket: RoomSocket, connected: boolean) {
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)

  const nextId = () => `${Date.now()}-${(counter.current += 1)}`
  const inFlight = useRef(false)

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || inFlight.current) return false
    if (!connected) {
      setError('연결이 끊어졌어요. 다시 연결되면 시도해 주세요.')
      return false
    }
    const clipped = Array.from(trimmed).slice(0, MAX_AI_QUESTION_LENGTH).join('')
    setMessages((previous) => [...previous, { id: nextId(), role: 'user', text: clipped }])
    setPending(true)
    setError(null)
    inFlight.current = true
    try {
      const { answer } = await emitWithAck<{ answer: string }>(
        (ack) => socket.emit('ai:ask', { question: clipped }, ack),
        ASK_TIMEOUT_MS,
      )
      setMessages((previous) => [...previous, { id: nextId(), role: 'assistant', text: answer }])
      return true
    } catch (askError) {
      setError(errorMessage(askError))
      return false
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }, [socket, connected, pending])

  return { messages, pending, error, ask, clearError: () => setError(null) }
}
