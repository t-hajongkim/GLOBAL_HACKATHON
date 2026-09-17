import { useState, type FormEvent } from 'react'
import { ArrowUp, Check, CheckCheck, ChevronDown, Crown, Hand, MessageCircle, Send, Sparkles, Users } from 'lucide-react'
import { PixelAvatar } from './PixelArt.tsx'
import { seatLabel } from './Theater.tsx'
import { MAX_QUESTION_LENGTH, type Question, type RoomSnapshot } from '../shared/protocol.ts'
import type { RoomActions } from '../hooks/useRoom.ts'

export type PanelTab = 'questions' | 'people'

function QuestionCard({ question, myId, isHost, actions, connected }: {
  question: Question
  myId: string
  isHost: boolean
  actions: RoomActions
  connected: boolean
}) {
  const voted = question.votes.includes(myId)
  return (
    <article className={`question-card ${question.answered ? 'is-answered' : ''}`} data-testid="question-card">
      <div className="question-author">
        <span className={`mini-avatar avatar-bg-${question.avatar}`}><PixelAvatar color={question.avatar} size={23} /></span>
        <strong>{question.authorName}</strong>
        {question.authorId === myId && <span className="mine-label">나</span>}
        {question.isDemo && <span className="example-label">예시</span>}
        <time dateTime={new Date(question.createdAt).toISOString()}>{new Date(question.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
      </div>
      <p>{question.text}</p>
      <div className="question-bottom">
        <button className={`vote-button ${voted ? 'voted' : ''}`} aria-pressed={voted}
          aria-label={`${question.authorName}의 질문에 공감 ${question.votes.length}개`}
          disabled={!connected} onClick={() => { void actions.vote(question.id) }}>
          <ArrowUp size={13} strokeWidth={2.5} /><span>{question.votes.length}</span><span>공감</span>
        </button>
        {isHost ? <button className={`answer-button ${question.answered ? 'answered' : ''}`}
          aria-label={`${question.text} ${question.answered ? '답변 대기로 변경' : '답변 완료로 표시'}`}
          aria-pressed={question.answered} disabled={!connected}
          onClick={() => { void actions.answer(question.id) }}>
          {question.answered ? <CheckCheck size={13} /> : <Check size={13} />}
          {question.answered ? '답변 완료' : '답변 표시'}
        </button> : question.answered && <span className="answered-label"><CheckCheck size={13} /> 답변 완료</span>}
      </div>
    </article>
  )
}

export function QuestionPanel({
  room, myId, actions, connected, tab, onTabChange, onEditProfile,
}: {
  room: RoomSnapshot | null
  myId: string
  actions: RoomActions
  connected: boolean
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  onEditProfile: () => void
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sort, setSort] = useState('popular')
  const [showAnswered, setShowAnswered] = useState(true)
  const [sent, setSent] = useState(false)
  const participants = room?.participants ?? []
  const actualPeople = participants.filter((participant) => !participant.isDemo)
  const demoPeople = participants.filter((participant) => participant.isDemo)
  const questions = [...(room?.questions ?? [])]
    .filter((question) => showAnswered || !question.answered)
    .sort((a, b) => Number(a.answered) - Number(b.answered)
      || (sort === 'popular' ? b.votes.length - a.votes.length : b.createdAt - a.createdAt)
      || a.createdAt - b.createdAt)
  const pendingCount = room?.questions.filter((question) => !question.answered).length ?? 0
  const isHost = room?.hostId === myId
  const raised = participants.filter((participant) => participant.handRaised)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || sending || !connected) return
    setSending(true)
    const success = await actions.question(text.trim())
    setSending(false)
    if (success) {
      setText('')
      setSent(true)
      window.setTimeout(() => setSent(false), 3_000)
    }
  }

  return (
    <aside className="question-panel" aria-label="질문과 참여자">
      <div className="panel-tabs" role="tablist" aria-label="미팅 사이드 패널">
        <button role="tab" id="questions-tab" aria-controls="questions-panel" aria-selected={tab === 'questions'}
          className={tab === 'questions' ? 'active' : ''} onClick={() => onTabChange('questions')}>
          <MessageCircle size={16} /> 질문 <span>{pendingCount}</span>
        </button>
        <button role="tab" id="people-tab" aria-controls="people-panel" aria-selected={tab === 'people'}
          className={tab === 'people' ? 'active' : ''} onClick={() => onTabChange('people')}>
          <Users size={16} /> 참여자 <span>{actualPeople.length}</span>
        </button>
      </div>
      {tab === 'questions' ? (
        <div className="questions-tab-content" role="tabpanel" id="questions-panel" aria-labelledby="questions-tab">
          <div className="panel-intro">
            <span className="panel-spark"><Sparkles size={18} /></span>
            <div><strong>좋은 질문은, 함께 나눠요.</strong><p>궁금한 질문에 공감도 눌러 주세요.</p></div>
          </div>
          {raised.length > 0 && <div className="hand-queue"><Hand size={15} /><span>{raised.map((participant) => participant.name).join(', ')}<strong> 손들었어요</strong></span></div>}
          <div className="question-sort">
            <span>우리의 질문 <b>{room?.questions.length ?? 0}</b></span>
            <label><span className="sr-only">질문 정렬</span><select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="popular">공감 많은 순</option><option value="recent">최신순</option>
            </select><ChevronDown size={12} /></label>
          </div>
          <div className="question-list">
            {questions.length ? questions.map((question) => (
              <QuestionCard key={question.id} question={question} myId={myId}
                isHost={isHost} actions={actions} connected={connected} />
            )) : <div className="empty-questions"><MessageCircle size={32} strokeWidth={1.3} /><strong>첫 질문의 주인공이 되어 주세요.</strong><p>작은 궁금증도 좋은 대화의 시작이에요.</p></div>}
          </div>
          <label className="answered-filter"><input type="checkbox" checked={showAnswered} onChange={(event) => setShowAnswered(event.target.checked)} /> 답변 완료된 질문도 보기</label>
          <form className="question-form" onSubmit={(event) => { void submit(event) }}>
            <label className="sr-only" htmlFor="question-input">발표자에게 질문하기</label>
            <textarea id="question-input" value={text} maxLength={MAX_QUESTION_LENGTH} rows={3}
              placeholder={'발표자에게 궁금한 점이 있나요?\n편하게 질문을 남겨 주세요.'}
              onChange={(event) => setText(event.target.value)} disabled={!connected} />
            <div className="question-form-bottom"><span>{text.length}<i> / {MAX_QUESTION_LENGTH}</i></span>
              <button className="send-question" type="submit" disabled={!text.trim() || sending || !connected}>
                {sent ? <Check size={14} /> : <Send size={14} />}
                {sending ? '보내는 중' : sent ? '보냈어요' : '질문 보내기'}
              </button>
            </div>
            <p className="question-privacy">질문은 이 방에 있는 모두에게 보여요.</p>
            <span className="sr-only" role="status">{sent ? '질문을 보냈어요.' : ''}</span>
          </form>
        </div>
      ) : (
        <div className="people-tab-content" role="tabpanel" id="people-panel" aria-labelledby="people-tab">
          <div className="panel-intro"><span className="panel-spark"><Users size={18} /></span><div><strong>같은 공간, 함께 있는 우리.</strong><p>실제 참여자 {actualPeople.length}명{demoPeople.length > 0 && ` · 예시 관객 ${demoPeople.length}명`}</p></div></div>
          <div className="people-list">
            {[...actualPeople, ...demoPeople].map((participant) => (
              <div key={participant.id} className="person-row" data-testid="person-row">
                <span className={`person-avatar avatar-bg-${participant.avatar}`}><PixelAvatar color={participant.avatar} size={30} /></span>
                <div><strong>{participant.name}{participant.id === myId && <span className="mine-label">나</span>}</strong>
                  <p>{participant.id === room?.hostId ? '발표자' : participant.isDemo ? '예시 관객' : '참여자'} <span>· {participant.seat === null ? '무대' : `${seatLabel(participant.seat)} 좌석`}</span></p></div>
                {participant.handRaised ? <span className="person-hand" aria-label="손들기">✋</span> : participant.id === room?.hostId ? <Crown size={15} className="host-crown" /> : <span className={participant.isDemo ? 'demo-person-dot' : 'online-person-dot'} />}
              </div>
            ))}
          </div>
          <button className="customize-link" onClick={onEditProfile}>내 이름과 캐릭터 바꾸기 <span>→</span></button>
        </div>
      )}
      <div className="panel-footnote"><span>✦</span> 작은 반응이 발표자에게 큰 힘이 돼요.</div>
    </aside>
  )
}
