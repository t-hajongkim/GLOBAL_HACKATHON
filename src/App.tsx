import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppWindow, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, CircleHelp,
  Clock3, DoorOpen, Footprints, Hand, LogOut, MessageCircle, MonitorUp,
  Pencil, Plus, Settings2, Smile, Sofa, Sparkles, Users, X,
} from 'lucide-react'
import { AiChatWidget } from './components/AiChatWidget.tsx'
import { Dialog } from './components/Dialog.tsx'
import { PixelAvatar, PixelLogo, PixelSprout } from './components/PixelArt.tsx'
import { QuestionPanel, type PanelTab } from './components/QuestionPanel.tsx'
import { HelpDialog, InviteDialog, ProfileDialog, TitleDialog } from './components/RoomDialogs.tsx'
import { Theater } from './components/Theater.tsx'
import { TeamsShareDialog } from './components/TeamsShareDialog.tsx'
import { useRoom, type Profile, type RoomTarget } from './hooks/useRoom.ts'
import { useScreenShare } from './hooks/useScreenShare.ts'
import { newRoomId } from './lib/socket.ts'
import { DEFAULT_ROOM_TITLE, REACTIONS, isLivePresentation, type ReactionEmoji } from './shared/protocol.ts'
import './App.css'

type Modal = 'profile' | 'invite' | 'new' | 'help' | 'title' | 'leave' | 'teams' | null
const reactionNames: Record<ReactionEmoji, string> = {
  '👏': '박수', '❤️': '하트', '👍': '좋아요', '😂': '웃음', '🎉': '축하', '💡': '아이디어',
}

function initialTarget(): RoomTarget {
  const requested = new URLSearchParams(window.location.search).get('room')
  return requested ? { id: requested, demo: false } : { id: `demo-${newRoomId()}`, demo: true }
}

function App() {
  const [target, setTarget] = useState<RoomTarget | null>(initialTarget)
  const [profile, setProfile] = useState<Profile>({ name: '민트', avatar: 'mint' })
  const { socket, room, myId, status, error, reactions, actions, reportError, clearError } = useRoom(target, profile)
  const screen = useScreenShare(socket, room, myId, reportError)
  const [modal, setModal] = useState<Modal>(null)
  const [tab, setTab] = useState<PanelTab>('questions')
  const [focused, setFocused] = useState(false)
  const [reactionOpen, setReactionOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const roomRef = useRef(room)
  const lastTarget = useRef(target)
  const me = room?.participants.find((participant) => participant.id === myId)
  const connected = status === 'connected'
  const isHost = room?.hostId === myId
  const isStreaming = isLivePresentation(room?.presentation.source)
  const isDemo = target?.demo ?? false
  const liveCount = room?.participants.filter((participant) => !participant.isDemo).length ?? 0
  const demoCount = room?.participants.filter((participant) => participant.isDemo).length ?? 0

  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => {
    const onPopState = () => setTarget(initialTarget())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 3_500)
  }, [])

  const openQuestions = useCallback(() => {
    setFocused(false)
    setTab('questions')
    window.setTimeout(() => {
      const input = document.getElementById('question-input')
      input?.focus({ preventScroll: true })
      if (window.innerWidth < 1_000) input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }, [])

  const react = useCallback((emoji: ReactionEmoji) => {
    void actions.react(emoji).then((success) => {
      if (success) {
        setReactionOpen(false)
        notify(`${emoji} ${reactionNames[emoji]}를 보냈어요`)
      }
    })
  }, [actions, notify])

  const move = useCallback((dx: number, dy: number) => {
    const current = roomRef.current?.participants.find((person) => person.id === socket.id)
    if (!current) return Promise.resolve(false)
    return actions.move(
      Math.max(10, Math.min(90, current.position.x + dx)),
      Math.max(48, Math.min(91, current.position.y + dy)),
    )
  }, [actions, socket])

  useEffect(() => {
    const keys = new Set<string>()
    let moving = false
    const onKeyDown = (event: KeyboardEvent) => {
      if (modal || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key)) {
        if (!focused && connected) {
          event.preventDefault()
          keys.add(key)
        }
        return
      }
      if (event.repeat) return
      if (key === 'h' && connected) {
        event.preventDefault()
        const current = roomRef.current?.participants.find((person) => person.id === socket.id)
        void actions.hand(!current?.handRaised)
      }
      if (key === 'q') { event.preventDefault(); openQuestions() }
      if (key === 'f') { event.preventDefault(); setFocused((value) => !value) }
      if (key === 'escape') { setFocused(false); setReactionOpen(false) }
      const reaction = REACTIONS[Number(key) - 1]
      if (/^[1-6]$/.test(key) && reaction && connected) react(reaction)
    }
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase())
    const clearKeys = () => keys.clear()
    const interval = window.setInterval(() => {
      if (moving || !keys.size || focused || !connected) return
      const dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'))
      const dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'))
      if (!dx && !dy) return
      moving = true
      const step = dx && dy ? 0.85 : 1.2
      void move(dx * step, dy * step).finally(() => { moving = false })
    }, 100)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearKeys)
    }
  }, [modal, focused, connected, actions, socket, openQuestions, react, move])

  const createRoom = () => {
    const next = { id: newRoomId(), demo: false }
    window.history.pushState({}, '', `?room=${next.id}`)
    setTarget(next)
    lastTarget.current = next
    setFocused(false)
    setModal('invite')
  }

  const leaveRoom = () => {
    lastTarget.current = target
    setTarget(null)
    setModal(null)
    setFocused(false)
    window.history.pushState({}, '', window.location.pathname)
  }
  const elapsed = Math.max(0, Math.floor((now - (room?.createdAt ?? now)) / 1_000))
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const roomUrl = `${window.location.origin}${window.location.pathname}?room=${target?.id ?? ''}`

  if (!target) return (
    <main className="exit-page"><div className="exit-card"><PixelLogo /><PixelSprout />
      <span className="room-tag">SEE YOU IN THE NEXT STORY</span>
      <h1>함께해서 더 좋은 시간이었어요.</h1><p>작은 만남이 오래 남는 이야기가 되기를.</p>
      <button className="primary-button" onClick={() => {
        const next = lastTarget.current ?? initialTarget()
        setTarget(next)
        if (!next.demo) window.history.pushState({}, '', `?room=${next.id}`)
      }}><DoorOpen size={17} /> 극장에 다시 입장하기</button>
      <button className="secondary-button" onClick={createRoom}><Plus size={16} /> 새로운 미팅룸 만들기</button>
    </div></main>
  )

  return (
    <div className="app-shell">
      <a className="sr-only skip-link" href="#meeting-room">미팅룸으로 건너뛰기</a>
      <aside className="side-rail" aria-label="스페이스 메뉴">
        <button className="brand-icon" aria-label="모여극장 이용 안내" onClick={() => setModal('help')}><PixelLogo /></button>
        <nav className="nav-items">
          <button className="nav-button active" aria-label="상영관" title="상영관" onClick={() => setFocused(false)}><Sofa size={22} /></button>
          <button className="nav-button" aria-label="참여자 보기" title="참여자" onClick={() => { setTab('people'); setFocused(false) }}><Users size={22} /></button>
          <button className="nav-button" aria-label="질문 패널 열기" title="질문 (Q)" onClick={openQuestions}><MessageCircle size={21} /></button>
          <span className="rail-separator" />
          <button className="nav-button" aria-label="새 미팅룸 만들기" title="새 미팅룸" onClick={() => setModal('new')}><Plus size={23} /></button>
        </nav>
        <div className="rail-bottom">
          <button className="nav-button" aria-label="이용 안내" title="이용 안내" onClick={() => setModal('help')}><CircleHelp size={21} /></button>
          <button className="nav-button" aria-label={isHost ? '미팅룸 설정' : '프로필 설정'} title="설정" disabled={!connected} onClick={() => setModal(isHost ? 'title' : 'profile')}><Settings2 size={21} /></button>
          <button className="rail-profile" aria-label="내 캐릭터 꾸미기" disabled={!connected} onClick={() => setModal('profile')}><PixelAvatar color={me?.avatar ?? profile.avatar} size={30} /></button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="header-brand"><PixelLogo small /><strong>모여극장<span>pixel meet</span></strong><span className="header-tagline">작은 공간, 더 가까운 우리.</span></div>
          <div className="header-right"><span className="header-chip"><Sparkles size={14} /> 함께라서 좋은 오늘</span>
            <button className="header-profile" disabled={!connected} onClick={() => setModal('profile')} aria-label="이름과 캐릭터 변경">
              <span className={`mini-avatar avatar-bg-${me?.avatar ?? profile.avatar}`}><PixelAvatar color={me?.avatar ?? profile.avatar} size={24} /></span>
              <span>{me?.name ?? profile.name}</span><ChevronRight size={14} />
            </button>
          </div>
        </header>
        <main className="workspace" id="meeting-room">
          <div className="room-heading">
            <div><div className="room-breadcrumb">우리의 스페이스 <ChevronRight size={11} /> 메이커스 라운지</div>
              <div className="room-title-line"><h1>{room?.title ?? DEFAULT_ROOM_TITLE}</h1><span className="room-tag">PIXEL SPACE</span>
                {isHost && <button className="icon-button" aria-label="미팅룸 이름 변경" onClick={() => setModal('title')}><Pencil size={14} /></button>}
              </div>
              <p className="room-subtitle">편한 자리에 앉아, 함께 이야기를 나눠요. <span>✦</span></p>
            </div>
            <div className="room-heading-actions">
              <div className={`connection-pill ${connected ? 'connected' : 'disconnected'}`} data-testid="connection-status"><span />{connected ? '실시간 연결' : status === 'failed' ? '입장 실패' : '연결 중'}</div>
              <span className="elapsed-time"><Clock3 size={13} />{timer}</span>
              <button className="invite-button" onClick={() => setModal('invite')}><Users size={16} /> 초대하기 <Plus size={15} /></button>
            </div>
          </div>
          <div className={`meeting-layout ${focused ? 'focus-mode' : ''}`}>
            <section className="theater-card" aria-label="가상 미팅룸">
              <Theater room={room} myId={myId} status={status} reactions={reactions} actions={actions}
                focused={focused} onToggleFocus={() => setFocused(!focused)}
                stream={screen.stream} isLocal={screen.isLocal} screenError={screen.screenError}
                onRetryScreen={() => { void screen.retry() }} />
              <div className="room-controls">
                <div className="controls-left">
                  <button className="my-profile-control" aria-label="내 프로필 변경" title="내 캐릭터" disabled={!connected} onClick={() => setModal('profile')}>
                    <PixelAvatar color={me?.avatar ?? profile.avatar} size={29} /><span>{me?.name ?? profile.name}<small>나</small></span>
                  </button>
                  <span className="control-divider" />
                  <button className={`control-button ${me?.handRaised ? 'is-active' : ''}`} disabled={!connected}
                    onClick={() => { void actions.hand(!me?.handRaised) }} aria-label={me?.handRaised ? '손 내리기' : '손들기'} aria-pressed={me?.handRaised ?? false} title="손들기 (H)">
                    <Hand size={19} /><span>{me?.handRaised ? '내리기' : '손들기'}</span>
                  </button>
                  <button className="control-button walk-control" disabled={!connected} aria-label="자리에서 일어나 둘러보기" title="둘러보기 · WASD 이동"
                    onClick={() => { void actions.move(50, 90).then((success) => { if (success) notify('WASD 또는 방향키로 걸어보세요. 바닥을 눌러도 이동해요.') }) }}>
                    <Footprints size={19} /><span>둘러보기</span>
                  </button>
                </div>
                <div className={`reaction-dock ${reactionOpen ? 'is-open' : ''}`} role="group" aria-label="이모지 리액션">
                  <span className="reaction-caption">작은 반응, 큰 응원</span>
                  <button className="control-button mobile-reaction-toggle" onClick={() => setReactionOpen(!reactionOpen)} aria-label="리액션 선택" aria-expanded={reactionOpen}><Smile size={21} /><span>리액션</span></button>
                  <div className="reaction-buttons">{REACTIONS.map((emoji, index) => <button key={emoji} className="reaction-button" disabled={!connected} onClick={() => react(emoji)} aria-label={`${reactionNames[emoji]} 리액션`} title={`${reactionNames[emoji]} (${index + 1})`}>{emoji}</button>)}</div>
                </div>
                <div className="controls-right">
                  {isHost ? <>
                    {!isStreaming && <button className="share-button teams-share-button" disabled={!connected || screen.busy}
                      onClick={() => setModal('teams')}><AppWindow size={17} /><span>Teams 창 공유</span></button>}
                    <button className={`share-button ${isStreaming ? 'is-sharing' : ''}`} disabled={!connected || screen.busy}
                      onClick={() => { void (isStreaming ? screen.stopSharing() : screen.startSharing()) }}>
                      <MonitorUp size={17} /><span>{screen.busy ? '선택 중…' : isStreaming ? '공유 중지' : '화면 공유'}</span>
                    </button>
                  </> : <button className="control-button" onClick={openQuestions}><MessageCircle size={19} /><span>질문하기</span></button>}
                  <button className="leave-button" aria-label="미팅룸 나가기" title="나가기" onClick={() => setModal('leave')}><LogOut size={18} /></button>
                </div>
              </div>
            </section>
            <QuestionPanel room={room} myId={myId} actions={actions} connected={connected}
              tab={tab} onTabChange={setTab} onEditProfile={() => setModal('profile')} />
          </div>
          <div className="world-help">
            <span className="keyboard-hint"><Footprints size={14} /><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 <i>·</i> 빈 좌석을 눌러 앉아 보세요</span>
            <span className="room-capacity"><Users size={14} /> 실제 참여 {liveCount}명{isDemo && ` · 예시 관객 ${demoCount}명`} <span>/ 24석</span></span>
          </div>
          {!focused && <div className="mobile-direction-pad" role="group" aria-label="캐릭터 이동">
            <span>걸어보기</span>
            <button aria-label="왼쪽으로 이동" disabled={!connected} onClick={() => { void move(-4, 0) }}><ArrowLeft size={18} /></button>
            <button aria-label="위로 이동" disabled={!connected} onClick={() => { void move(0, -4) }}><ArrowUp size={18} /></button>
            <button aria-label="아래로 이동" disabled={!connected} onClick={() => { void move(0, 4) }}><ArrowDown size={18} /></button>
            <button aria-label="오른쪽으로 이동" disabled={!connected} onClick={() => { void move(4, 0) }}><ArrowRight size={18} /></button>
          </div>}
          {isDemo && <div className="demo-notice"><span>PREVIEW</span> 지금은 예시 관객과 함께하는 체험 공간이에요. <button onClick={() => setModal('invite')}>우리만의 진짜 미팅룸 열기 <ArrowRight size={13} /></button></div>}
          <div className="footer-note"><span>MADE FOR LITTLE MOMENTS, TOGETHER.</span><span>모여극장 <i>✦</i> PIXEL MEET</span></div>
        </main>
      </div>
      {error && <div className="error-toast" role="alert"><span>{error}</span><button onClick={clearError} aria-label="오류 알림 닫기"><X size={17} /></button></div>}
      {toast && <div className="toast-message" role="status"><Check size={16} />{toast}</div>}
      <AiChatWidget socket={socket} connected={connected} />
      {modal === 'profile' && <ProfileDialog profile={{ name: me?.name ?? profile.name, avatar: me?.avatar ?? profile.avatar }}
        onSave={async (next) => { const success = await actions.profile(next); if (success) setProfile(next); return success }}
        onClose={() => setModal(null)} />}
      {(modal === 'invite' || modal === 'new') && <InviteDialog isDemo={isDemo || modal === 'new'} roomUrl={roomUrl}
        onCreate={createRoom} onClose={() => setModal(null)} onError={reportError} />}
      {modal === 'help' && <HelpDialog onClose={() => setModal(null)} />}
      {modal === 'teams' && room && <TeamsShareDialog key={room.id}
        canShare={connected && isHost}
        onStart={(stream) => screen.shareTeams(stream, room.id)} onClose={() => setModal(null)} />}
      {modal === 'title' && room && <TitleDialog title={room.title} onSave={actions.title} onClose={() => setModal(null)} />}
      {modal === 'leave' && <Dialog title="극장에서 나갈까요?" onClose={() => setModal(null)}>
        <p className="dialog-description">{isHost ? '다음 참여자에게 발표자 역할이 넘어가고 화면 공유가 종료돼요.' : '내 캐릭터가 퇴장하고 좌석이 비워져요.'}<br />모두 나가면 이 방의 질문과 기록은 사라져요.</p>
        <button className="primary-button full-width" onClick={leaveRoom}><LogOut size={17} /> 나가기</button>
        <button className="secondary-button full-width" onClick={() => setModal(null)}>조금 더 함께 있을게요</button>
      </Dialog>}
    </div>
  )
}

export default App
