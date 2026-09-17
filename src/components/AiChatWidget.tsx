import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Send, Sparkles, X } from 'lucide-react'
import { useAiChat } from '../hooks/useAiChat.ts'
import { MAX_AI_QUESTION_LENGTH } from '../shared/protocol.ts'
import type { RoomSocket } from '../hooks/useRoom.ts'

// Floating, private per-attendee chat widget: answers come only from whatever
// background material the host has shared with the room (see room.context on
// the server). Nothing here is broadcast to other participants or persisted.
export function AiChatWidget({ socket, connected }: { socket: RoomSocket; connected: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const { messages, pending, error, ask, clearError } = useAiChat(socket, connected)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  const submit = (event: { preventDefault: () => void }) => {
    const question = text
    setText('')
    void ask(question)
  }

  return (
    <div className="ai-chat-widget">
      {open && (
        <section className="ai-chat-panel" role="dialog" aria-label="AI 질문 도우미">
          <header className="ai-chat-header">
            <span className="ai-chat-title"><Sparkles size={15} /> AI 질문 도우미</span>
            <button className="icon-button" aria-label="닫기" onClick={() => setOpen(false)}><X size={18} /></button>
          </header>
          <p className="ai-chat-subtitle">발표자가 공유한 자료를 바탕으로 답해요. 나만 볼 수 있어요.</p>
          <div className="ai-chat-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="ai-chat-empty">
                <Bot size={28} strokeWidth={1.3} />
                <p>부끄러워서 못 물어본 질문, 여기서 편하게 물어보세요.</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`ai-chat-bubble ${message.role}`}>{message.text}</div>
            ))}
            {pending && <div className="ai-chat-bubble assistant ai-chat-typing" aria-live="polite">생각하는 중…</div>}
          </div>
          {error && <div className="ai-chat-error" role="alert">
            <span>{error}</span><button onClick={clearError} aria-label="오류 닫기"><X size={14} /></button>
          </div>}
          <form className="ai-chat-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="ai-chat-input">AI 도우미에게 질문하기</label>
            <textarea id="ai-chat-input" rows={2} value={text} maxLength={MAX_AI_QUESTION_LENGTH}
              placeholder="궁금한 점을 편하게 물어보세요…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event) }
              }}
              disabled={!connected} />
            <button type="submit" disabled={!text.trim() || pending || !connected} aria-label="질문 보내기">
              <Send size={15} />
            </button>
          </form>
        </section>
      )}
      <button className="ai-chat-toggle" onClick={() => setOpen((value) => !value)}
        aria-expanded={open} aria-label={open ? 'AI 질문 도우미 닫기' : 'AI 질문 도우미 열기'}>
        <Bot size={22} />
      </button>
    </div>
  )
}
