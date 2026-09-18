import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Hand, LoaderCircle, Maximize2, Minimize2, Monitor, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { PixelAvatar, PixelChair, PixelPlant, PixelSprout } from './PixelArt.tsx'
import { DEFAULT_ROOM_TITLE, SEAT_COUNT, SLIDE_COUNT, isLivePresentation, type Participant, type Reaction, type RoomSnapshot } from '../shared/protocol.ts'
import type { ConnectionStatus, QuestionBubble, RoomActions } from '../hooks/useRoom.ts'

const seatColumns = [18, 26, 34, 42, 58, 66, 74, 82]

export function seatLabel(seat: number): string {
  return `${String.fromCharCode(65 + Math.floor(seat / 8))}${seat % 8 + 1}`
}

function Slide({ index }: { index: number }) {
  const slides = [
    { eyebrow: 'A LITTLE IDEA. A BIG POSSIBILITY.', title: <>작은 아이디어,<br />큰 가능성.</>, body: '우리의 다음 이야기는, 여기서 시작돼요.', note: '편하게 앉아, 함께 상상해 주세요.' },
    { eyebrow: 'TODAY, WE GROW TOGETHER.', title: <>오늘은 어떤 생각을<br />가져오셨나요?</>, body: '인사 나누기  →  아이디어 나누기  →  함께 질문하기', note: '크지 않아도 괜찮아요. 작은 생각부터 나눠요.' },
    { eyebrow: 'SAME ROOM. DIFFERENT PLACES.', title: <>화면 너머에서도,<br />우리는 함께.</>, body: '고개를 끄덕이는 대신, 작은 리액션 하나.', note: '마음에 드는 이야기에 따뜻한 박수를 보내요.' },
    { eyebrow: 'EVERY QUESTION IS A NEW BEGINNING.', title: <>좋은 질문이<br />다음 장을 열어요.</>, body: '궁금한 건 질문으로, 같은 마음은 공감으로.', note: '이제, 여러분의 이야기를 들려주세요.' },
  ]
  const slide = slides[index] ?? slides[0]
  return (
    <div className={`presentation-slide slide-${index}`} data-testid="presentation-slide">
      <div className="slide-eyebrow"><span className="tiny-spark">✦</span> MAKERS CLUB <span>2026 · VOL. 09</span></div>
      <div className="slide-copy">
        <p className="slide-kicker">{slide.eyebrow}</p>
        <h2>{slide.title}</h2>
        <p className="slide-description">{slide.body}</p>
      </div>
      <div className="slide-art"><PixelSprout variant={index} /><span>LET'S GROW<br />TOGETHER</span></div>
      <div className="slide-footnote"><span>{slide.note}</span><span>{String(index + 1).padStart(2, '0')} <i>/</i> 04</span></div>
    </div>
  )
}

function SharedScreen({ stream, isLocal, isTeams }: { stream: MediaStream; isLocal: boolean; isTeams: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [needsPlay, setNeedsPlay] = useState(false)
  const [playError, setPlayError] = useState(false)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream
    void video.play().catch(() => setNeedsPlay(true))
    return () => { video.srcObject = null }
  }, [stream])

  return (
    <div className="shared-screen">
      <video ref={ref} autoPlay playsInline muted={isTeams || isLocal || muted} data-testid="shared-video"
        aria-label={isLocal ? '내 공유 화면' : '발표자의 공유 화면'} onError={() => setPlayError(true)} />
      {needsPlay && <button className="screen-play" onClick={() => {
        void ref.current?.play().then(() => setNeedsPlay(false)).catch(() => setPlayError(true))
      }}>클릭해서 발표 화면 재생</button>}
      {playError && <p className="video-error" role="alert">영상을 재생하지 못했어요. 발표자에게 다시 공유해 달라고 요청해 주세요.</p>}
      {isTeams && <span className="teams-stream-badge">Teams 창 · LIVE <span>음성은 Teams에서</span></span>}
      {!isLocal && !isTeams && <button className="screen-audio" onClick={() => setMuted(!muted)}
        aria-label={muted ? '발표 소리 켜기' : '발표 소리 끄기'}>
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        {muted ? '발표 소리 켜기' : '소리 켜짐'}
      </button>}
    </div>
  )
}

function Seat({
  index, participant, myId, disabled, onSelect,
}: {
  index: number
  participant?: Participant
  myId: string
  disabled: boolean
  onSelect: () => void
}) {
  const mine = participant?.id === myId
  return (
    <button className={`theater-seat ${participant ? 'occupied' : 'empty'} ${mine ? 'my-seat' : ''}`}
      style={{ left: `${seatColumns[index % 8]}%`, top: `${57 + Math.floor(index / 8) * 14}%` }}
      onClick={onSelect} disabled={disabled || Boolean(participant && !mine)}
      aria-label={`좌석 ${seatLabel(index)}, ${participant ? `${participant.name}${mine ? ' (나)' : ''}` : '빈자리'}`}
      aria-pressed={mine} data-testid={`seat-${index}`} data-occupied={Boolean(participant)}
      title={participant ? `${participant.name}${participant.isDemo ? ' · 예시 관객' : ''}` : `${seatLabel(index)}에 앉기`}>
      <PixelChair />
      {participant && <PixelAvatar color={participant.avatar} back className="seated-avatar" />}
      {!participant && <span className="empty-seat-plus">+</span>}
      {participant?.handRaised && <span className="seat-hand" aria-label="손든 참여자">✋</span>}
      <span className="seat-name">{participant ? <>{participant.name}{mine && <b>나</b>}</> : seatLabel(index)}</span>
      {mine && <span className="you-arrow" aria-hidden="true">▾</span>}
    </button>
  )
}

export function Theater({
  room, myId, status, reactions, questionBubbles, actions, focused, onToggleFocus,
  stream, isLocal, screenError, onRetryScreen,
}: {
  room: RoomSnapshot | null
  myId: string
  status: ConnectionStatus
  reactions: Reaction[]
  questionBubbles: QuestionBubble[]
  actions: RoomActions
  focused: boolean
  onToggleFocus: () => void
  stream: MediaStream | null
  isLocal: boolean
  screenError: string | null
  onRetryScreen: () => void
}) {
  const host = room?.participants.find((participant) => participant.id === room.hostId)
  const isHost = room?.hostId === myId
  const currentSlide = room?.presentation.slide ?? 0
  const connected = status === 'connected'
  const raisedCount = room?.participants.filter((participant) => participant.handRaised).length ?? 0

  return (
    <>
      <div className="theater-topbar">
        <div className="theater-room-name"><span className="live-dot" /> {room?.isDemo ? '체험 상영관' : '우리의 상영관'} <span className="room-number">ROOM 01</span></div>
        <button className="theater-focus" onClick={onToggleFocus} aria-pressed={focused}>
          {focused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {focused ? '극장으로 돌아가기' : '화면만 보기'} <kbd>F</kbd>
        </button>
      </div>
      <div className={`theater-scene ${focused ? 'is-focused' : ''}`} data-testid="theater-scene"
        aria-label={`${room?.title ?? DEFAULT_ROOM_TITLE} 픽셀 극장`}
        onClick={(event) => {
          if (focused || !connected || !(event.target instanceof Element)
            || event.target.closest('button, .screen-frame')) return
          const rect = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - rect.left) / rect.width * 100
          const y = (event.clientY - rect.top) / rect.height * 100
          if (x >= 10 && x <= 90 && y >= 48 && y <= 91) void actions.move(x, y)
        }}>
        <div className="room-backwall" aria-hidden="true" />
        <div className="wood-floor" aria-hidden="true" />
        <div className="floor-rug" aria-hidden="true" />
        <div className="center-aisle" aria-hidden="true"><span /><span /><span /></div>
        <div className="wall-pillar pillar-left" aria-hidden="true" />
        <div className="wall-pillar pillar-right" aria-hidden="true" />
        <div className="wall-light light-left" aria-hidden="true"><i /><b /><i /></div>
        <div className="wall-light light-right" aria-hidden="true"><i /><b /><i /></div>
        <div className="wall-sign" aria-hidden="true"><span>WELCOME TO</span><b>모여극장</b><i>✦ ✦ ✦</i></div>
        <div className="wall-poster" aria-hidden="true"><span>GOOD<br />THINGS<br />GROW<br />HERE.</span><PixelSprout /></div>
        <div className="star-garland" aria-hidden="true"><i />✦<i />✦<i />✦<i />✦<i />✦<i /></div>
        <div className="stage-shadow" aria-hidden="true" />
        <div className="stage-deck" aria-hidden="true"><div className="stage-stairs" /></div>
        <div className="screen-frame">
          <div className="curtain curtain-left" aria-hidden="true" />
          <div className="curtain curtain-right" aria-hidden="true" />
          <div className="screen-content">
            {isLivePresentation(room?.presentation.source) ? (
              stream ? <SharedScreen stream={stream} isLocal={isLocal} isTeams={room?.presentation.source === 'teams'} /> : (
                <div className="screen-waiting">
                  {screenError ? <Monitor size={32} /> : <LoaderCircle size={28} className="spin" />}
                  <p>{screenError ?? '발표자의 화면을 연결하고 있어요'}</p>
                  {screenError && <button onClick={onRetryScreen}><RotateCcw size={14} /> 다시 연결</button>}
                </div>
              )
            ) : <Slide index={currentSlide} />}
          </div>
          <div className="screen-bottom-edge" aria-hidden="true" />
        </div>
        {host && host.seat === null && host.position.y < 48 && <div className="stage-presenter">
          <span className="presenter-spotlight" aria-hidden="true" />
          <PixelAvatar color={host.avatar} />
          {host.handRaised && <span className="presenter-hand">✋</span>}
          <span className="presenter-name">{host.name}{isHost && ' (나)'} <span>발표자</span></span>
        </div>}
        <div className="stage-microphone" aria-hidden="true"><i /><span /><b /></div>
        <div className="stage-plant plant-left" aria-hidden="true"><PixelPlant /></div>
        <div className="stage-plant plant-right" aria-hidden="true"><PixelPlant variant={1} /></div>
        <div className="audience-seats" role="group" aria-label="관객석 · 빈 좌석을 눌러 이동">
          {Array.from({ length: SEAT_COUNT }, (_, index) => (
            <Seat key={index} index={index} myId={myId}
              participant={room?.participants.find((participant) => participant.seat === index)}
              disabled={!connected}
              onSelect={() => { void actions.seat(index) }} />
          ))}
        </div>
        <div className="walking-avatars">
          {room?.participants.filter((participant) => participant.seat === null && participant.position.y >= 48).map((participant) => (
            <div key={participant.id} className={`walking-avatar ${participant.id === myId ? 'is-me' : ''}`}
              data-testid={participant.id === myId ? 'my-walking-avatar' : 'walking-avatar'}
              style={{ left: `${participant.position.x}%`, top: `${participant.position.y}%`, zIndex: Math.round(participant.position.y) }}>
              <PixelAvatar color={participant.avatar} size={46} />
              {participant.handRaised && <span className="seat-hand">✋</span>}
              <span className="walking-name">{participant.name}{participant.id === myId && <b>나</b>}</span>
            </div>
          ))}
        </div>
        <div className="avatar-question-layer" aria-live="polite" aria-relevant="additions text">
          {questionBubbles.map((bubble) => {
            const participant = room?.participants.find((person) => person.id === bubble.participantId)
            if (!participant) return null
            const seat = participant.seat
            const seated = seat !== null
            const onStage = !seated && participant.position.y < 48
            const x = seat !== null ? seatColumns[seat % 8] : onStage ? 69 : participant.position.x
            const y = seat !== null ? 57 + Math.floor(seat / 8) * 14 : onStage ? 44 : participant.position.y
            return <div key={bubble.id}
              className={`avatar-question-bubble ${seated ? 'is-seated' : 'is-standing'} ${participant.id === myId ? 'is-me' : ''}`}
              data-testid="question-bubble" data-participant-id={participant.id}
              style={{ left: `clamp(92px, ${x}%, calc(100% - 92px))`, top: `${y}%` }}
              aria-label={`${participant.name}의 질문: ${bubble.text}`} title={bubble.text}>
              <span>{participant.name}<b>질문</b></span>
              <p>{bubble.text}</p>
            </div>
          })}
        </div>
        <div className="row-label row-a" aria-hidden="true">A</div>
        <div className="row-label row-b" aria-hidden="true">B</div>
        <div className="row-label row-c" aria-hidden="true">C</div>
        <div className="front-plant front-left" aria-hidden="true"><PixelPlant /></div>
        <div className="front-plant front-right" aria-hidden="true"><PixelPlant variant={1} /></div>
        <div className="exit-sign" aria-hidden="true">EXIT →</div>
        <div className="room-minimap" aria-label="참여자 위치 미니맵">
          <span className="mini-stage" />
          {room?.participants.map((participant) => <i key={participant.id} className={participant.id === myId ? 'is-me' : ''}
            style={{ left: `${participant.position.x}%`, top: `${participant.position.y}%` }} />)}
        </div>
        <div className="floating-reactions" aria-live="off">
          {reactions.map((reaction) => {
            const participant = room?.participants.find((person) => person.id === reaction.participantId)
            const seat = participant?.seat
            return <span key={reaction.id} className="floating-reaction" data-testid="floating-reaction"
              style={{
                left: `${seat != null ? seatColumns[seat % 8] : participant?.position.x ?? 50}%`,
                top: `${seat != null ? 54 + Math.floor(seat / 8) * 14 : participant?.position.y ?? 85}%`,
              }} aria-label={`${participant?.name ?? '참여자'}의 리액션 ${reaction.emoji}`}>
              {reaction.emoji}<i>✦</i>
            </span>
          })}
        </div>
        {raisedCount > 0 && <div className="hands-badge"><Hand size={13} /> {raisedCount}명이 손을 들었어요</div>}
        {!connected && <div className="connection-overlay" role="status">
          {status === 'failed' ? <Monitor size={24} /> : <LoaderCircle size={24} className="spin" />}
          <strong>{status === 'failed' ? '이 상영관에 입장할 수 없어요' : status === 'disconnected' ? '잠시만요, 다시 연결하고 있어요' : '따뜻한 상영관을 준비하고 있어요'}</strong>
        </div>}
      </div>
      <div className="presentation-status">
        <div><span className="live-dot" /><span data-testid="presentation-source">{room?.presentation.source === 'teams' ? 'Teams 창 스트리밍 중' : room?.presentation.source === 'screen' ? '화면 공유 중' : '샘플 발표 자료'}</span><span className="status-divider">·</span><span>{host?.name ?? '연결 중'} <span className="muted">발표자</span></span></div>
        <div className="slide-navigation" role="group" aria-label="발표 슬라이드">
          <button className="icon-button" aria-label="이전 슬라이드" disabled={!isHost || currentSlide === 0 || !connected}
            onClick={() => { void actions.slide(currentSlide - 1) }}><ChevronLeft size={16} /></button>
          <span data-testid="slide-counter">{currentSlide + 1} <i>/ {SLIDE_COUNT}</i></span>
          <button className="icon-button" aria-label="다음 슬라이드" disabled={!isHost || currentSlide === SLIDE_COUNT - 1 || !connected}
            onClick={() => { void actions.slide(currentSlide + 1) }}><ChevronRight size={16} /></button>
        </div>
      </div>
    </>
  )
}
