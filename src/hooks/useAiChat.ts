import { useCallback, useRef, useState } from 'react'
import { errorMessage } from '../lib/socket.ts'
import { MAX_AI_QUESTION_LENGTH } from '../shared/protocol.ts'
import type { RoomSocket } from './useRoom.ts'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const ASK_TIMEOUT_MS = 25_000

// Kept private to this browser tab only (per-attendee, never broadcast or persisted).
export function useAiChat(socket: RoomSocket, connected: boolean) {
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)

  const nextId = () => `${Date.now()}-${(counter.current += 1)}`

  const ask = useCallback(async (question: string) => {
    const trimmed = question.trim()
    if (!trimmed || pending) return false
    if (!connected) {
      setError('연결이 끊어졌어요. 다시 연결되면 시도해 주세요.')
      return false
    }
    const clipped = Array.from(trimmed).slice(0, MAX_AI_QUESTION_LENGTH).join('')
    setMessages((previous) => [...previous, { id: nextId(), role: 'user', text: clipped }])
    setPending(true)
    setError(null)
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error('AI 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.'))
        }, ASK_TIMEOUT_MS)
        socket.emit('ai:ask', { question: clipped }, (result) => {
          window.clearTimeout(timeout)
          if (result.ok) resolve(result.data.answer)
          else reject(new Error(result.error))
        })
      })
      setMessages((previous) => [...previous, { id: nextId(), role: 'assistant', text: answer }])
      return true
    } catch (askError) {
      setError(errorMessage(askError))
      return false
    } finally {
      setPending(false)
    }
  }, [socket, connected, pending])

  return { messages, pending, error, ask, clearError: () => setError(null) }
}
