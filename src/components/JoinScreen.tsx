import { useState, type FormEvent } from 'react'
import { ArrowRight, Crown, FileText, LoaderCircle, Sparkles, UploadCloud, Users, X } from 'lucide-react'
import { PixelAvatar, PixelLogo, PixelSprout } from './PixelArt.tsx'
import { DEFAULT_ROOM_TITLE, MATERIAL_MIME_TYPES, type JoinRole } from '../shared/protocol.ts'
import { formatFileSize, validateMaterialFiles } from '../lib/materials.ts'
import type { Profile } from '../hooks/useRoom.ts'
import './JoinScreen.css'

export interface JoinDraft {
  role: JoinRole
  name: string
  roomId: string
  title: string
  files: File[]
}

export function JoinScreen({
  profile, initialRoomId, busy, progress, error, canRetryUpload, onJoin, onDemo, onRetryUpload,
}: {
  profile: Profile
  initialRoomId: string
  busy: boolean
  progress: string
  error: string | null
  canRetryUpload: boolean
  onJoin: (draft: JoinDraft) => void
  onDemo: () => void
  onRetryUpload: () => void
}) {
  const [role, setRole] = useState<JoinRole>(initialRoomId ? 'attendee' : 'host')
  const [name, setName] = useState(profile.name)
  const [title, setTitle] = useState(DEFAULT_ROOM_TITLE)
  const [roomCode, setRoomCode] = useState(initialRoomId)
  const [files, setFiles] = useState<File[]>([])
  const [inputError, setInputError] = useState<string | null>(null)

  const selectFiles = (selected: File[]) => {
    const next = [...files, ...selected]
    const issue = validateMaterialFiles(next)
    if (issue) { setInputError(issue); return }
    setInputError(null)
    setFiles(next)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    let roomId = roomCode.trim()
    if (role === 'attendee' && /^https?:\/\//i.test(roomId)) {
      try { roomId = new URL(roomId).searchParams.get('room') ?? '' }
      catch { setInputError('초대 링크 형식을 확인해 주세요.'); return }
    }
    if (!name.trim()) { setInputError('이름을 입력해 주세요.'); return }
    if (role === 'attendee' && !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
      setInputError('Host에게 받은 방 코드 또는 초대 링크를 입력해 주세요.')
      return
    }
    if (role === 'host' && !title.trim()) { setInputError('방 이름을 입력해 주세요.'); return }
    const issue = role === 'host' ? validateMaterialFiles(files) : null
    if (issue) { setInputError(issue); return }
    setInputError(null)
    onJoin({ role, name: name.trim(), roomId, title: title.trim(), files: role === 'host' ? files : [] })
  }

  return (
    <main className="join-page">
      <header className="join-brand"><PixelLogo /><strong>모여극장 <span>PIXEL MEET</span></strong><span>작은 공간, 더 가까운 우리.</span></header>
      <div className="join-layout">
        <section className="join-story">
          <span className="join-eyebrow">A ROOM FOR EVERY IDEA</span>
          <h1>오늘의 만남,<br />어떤 역할로<br /><em>시작할까요?</em></h1>
          <p>이야기를 준비하는 Host,<br />함께 반응하고 질문하는 Attendee.<br />서로 다른 자리에서 같은 이야기를 만나요.</p>
          <div className="join-pixel-scene" aria-hidden="true"><span className="join-pixel-screen">LET'S GROW<br />TOGETHER <i>✦</i></span><PixelAvatar color="mint" size={64} /><PixelSprout /><PixelAvatar color="lilac" size={64} /></div>
          <div className="join-agent-note"><Sparkles size={18} /><span>업로드한 자료는 방에 연결돼요.<br /><strong>추후 AI 에이전트가 연결될 준비 공간입니다.</strong></span></div>
        </section>
        <section className="join-card" aria-label="미팅룸 입장">
          <div className="join-card-heading"><span>WELCOME TO OUR LITTLE THEATER</span><h2>함께할 준비를 해요</h2></div>
          <form onSubmit={submit}>
            <fieldset className="join-role-options" disabled={busy}>
              <legend>참여 역할</legend>
              <label className={role === 'host' ? 'selected' : ''}><input type="radio" name="join-role" value="host" checked={role === 'host'} onChange={() => { setRole('host'); setInputError(null) }} /><Crown size={23} /><strong>Host</strong><span>새 공간 열기 · 자료 준비</span></label>
              <label className={role === 'attendee' ? 'selected' : ''}><input type="radio" name="join-role" value="attendee" checked={role === 'attendee'} onChange={() => { setRole('attendee'); setInputError(null) }} /><Users size={23} /><strong>Attendee</strong><span>초대받은 공간에 참여</span></label>
            </fieldset>
            <label className="field-label" htmlFor="join-name">참여 이름</label>
            <input className="text-input" id="join-name" value={name} maxLength={20} disabled={busy} required onChange={(event) => setName(event.target.value)} autoComplete="nickname" />
            {role === 'host' ? <>
              <label className="field-label" htmlFor="join-title">미팅룸 이름</label>
              <input className="text-input" id="join-title" value={title} maxLength={60} disabled={busy} required onChange={(event) => setTitle(event.target.value)} />
              <div className="join-material-heading"><strong>발표 자료</strong><span>선택 사항 · 최대 5개 / 파일당 10MB</span></div>
              <label className={`join-upload ${busy ? 'is-disabled' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault()
                if (!busy) selectFiles(Array.from(event.dataTransfer.files))
              }}>
                <UploadCloud size={27} /><strong>자료를 끌어 놓거나 파일을 선택하세요</strong><span>PDF · PPTX · DOCX · TXT · MD · CSV · PNG · JPG</span>
                <input type="file" aria-label="발표 자료 업로드" accept={Object.keys(MATERIAL_MIME_TYPES).join(',')} multiple disabled={busy} onChange={(event) => {
                  selectFiles(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }} />
              </label>
              {files.length > 0 && <ul className="join-file-list">{files.map((file, index) => (
                <li key={`${file.name}-${index}`}><FileText size={17} /><span>{file.name}<small>{formatFileSize(file.size)}</small></span>
                  <button type="button" className="icon-button" aria-label={`${file.name} 제거`} disabled={busy} onClick={() => setFiles(files.filter((_, item) => item !== index))}><X size={15} /></button>
                </li>
              ))}</ul>}
              <p className="join-material-help">방이 열리면 참석자와 연결된 에이전트가 원본 자료를 볼 수 있어요. AI 분석은 아직 실행되지 않아요.</p>
            </> : <>
              <label className="field-label" htmlFor="join-code">방 코드 또는 초대 링크</label>
              <input className="text-input" id="join-code" value={roomCode} disabled={busy} required placeholder="Host에게 받은 초대 링크를 붙여 넣으세요" onChange={(event) => setRoomCode(event.target.value)} />
              <div className="attendee-note"><Users size={20} /><p>Host가 연 방에 입장해요.<br />자료 보기, 질문, 공감과 리액션을 함께할 수 있어요.</p></div>
            </>}
            {(inputError || error) && <p className="join-error" role="alert">{inputError ?? error}</p>}
            {canRetryUpload && <button type="button" className="secondary-button full-width" onClick={onRetryUpload} disabled={busy}>남은 자료 다시 올리기</button>}
            <button className="primary-button full-width join-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : role === 'host' ? <Crown size={18} /> : <Users size={18} />}
              {busy ? progress : role === 'host' ? 'Host로 방 열기' : 'Attendee로 입장'}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>
          <button className="join-demo" type="button" disabled={busy} onClick={onDemo}>먼저 체험해 보기 <span>→</span></button>
        </section>
      </div>
      <footer className="join-footer">MADE FOR LITTLE MOMENTS, TOGETHER. <span>모여극장 ✦ PIXEL MEET</span></footer>
    </main>
  )
}
