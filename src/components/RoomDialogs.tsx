import { useState, type FormEvent } from 'react'
import { Check, CheckCheck, Copy, DoorOpen, Link, MonitorUp, Sparkles, Users } from 'lucide-react'
import { Dialog } from './Dialog.tsx'
import { PixelAvatar, PixelSprout } from './PixelArt.tsx'
import { AVATARS, type AvatarColor } from '../shared/protocol.ts'
import type { Profile } from '../hooks/useRoom.ts'

const avatarNames: Record<AvatarColor, string> = {
  mint: '민트 정원사', lilac: '라일락 몽상가', peach: '복숭아 모험가',
  sky: '하늘 탐험가', sunflower: '해바라기 산책가', rose: '장미 이야기꾼',
}

export function ProfileDialog({ profile, onSave, onClose }: {
  profile: Profile
  onSave: (profile: Profile) => Promise<boolean>
  onClose: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    const success = await onSave({ name: name.trim(), avatar })
    setSaving(false)
    if (success) onClose()
  }
  return (
    <Dialog title="오늘은 어떤 모습으로 만날까요?" onClose={onClose}>
      <p className="dialog-description">작은 캐릭터에 나만의 분위기를 담아 보세요.</p>
      <div className={`profile-preview avatar-bg-${avatar}`}><PixelAvatar color={avatar} size={76} /><span>{avatarNames[avatar]}</span></div>
      <form onSubmit={(event) => { void submit(event) }}>
        <fieldset className="avatar-options"><legend>캐릭터 선택</legend>
          {AVATARS.map((color) => <button key={color} type="button"
            className={`avatar-option avatar-bg-${color} ${avatar === color ? 'selected' : ''}`}
            aria-label={avatarNames[color]} aria-pressed={avatar === color} onClick={() => setAvatar(color)}>
            <PixelAvatar color={color} size={34} />{avatar === color && <span><Check size={11} /></span>}
          </button>)}
        </fieldset>
        <label className="field-label" htmlFor="profile-name">극장에서 불릴 이름</label>
        <input id="profile-name" className="text-input" value={name} maxLength={20} required
          autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
        <button className="primary-button full-width" disabled={!name.trim() || saving} type="submit">
          {saving ? '저장하는 중…' : '이 모습으로 참여하기'} <Sparkles size={16} />
        </button>
      </form>
    </Dialog>
  )
}

export function InviteDialog({ isDemo, roomUrl, onCreate, onClose, onError }: {
  isDemo: boolean
  roomUrl: string
  onCreate: () => void
  onClose: () => void
  onError: (message: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('이 브라우저에서는 자동 복사를 지원하지 않아요. 아래 링크를 직접 선택해 복사해 주세요.')
      await navigator.clipboard.writeText(roomUrl)
      setCopied(true)
    } catch (error) {
      onError(error instanceof Error ? error.message : '링크를 복사하지 못했어요. 링크를 직접 선택해 복사해 주세요.')
    }
  }
  return (
    <Dialog title={isDemo ? '우리만의 상영관을 열어요' : '함께 앉을 사람을 초대해요'} onClose={onClose}>
      <div className="invite-art"><PixelAvatar color="peach" size={42} /><PixelSprout /><PixelAvatar color="lilac" size={42} /></div>
      {isDemo ? <>
        <p className="dialog-description">지금은 기능을 둘러보는 체험 공간이에요.<br />새 방에는 예시 관객 8명과 질문 3개가 준비돼요. 초대 링크로 팀원들과 함께해요.</p>
        <div className="invite-feature"><Users size={17} /><span>관객석 24개 · 회원가입 없이 링크로 입장</span></div>
        <div className="invite-feature"><MonitorUp size={17} /><span>발표 화면 공유 · 실시간 질문과 리액션</span></div>
        <button className="primary-button full-width" onClick={onCreate}><DoorOpen size={17} /> 실제 미팅룸 만들기</button>
      </> : <>
        <p className="dialog-description">이 링크를 공유하면 같은 극장에 입장해요.<br />링크를 아는 사람은 누구나 참여할 수 있어요.</p>
        <label htmlFor="invite-url" className="field-label">우리 방 초대 링크</label>
        <div className="invite-url"><Link size={16} /><input id="invite-url" value={roomUrl} readOnly onFocus={(event) => event.target.select()} /></div>
        <button className="primary-button full-width" onClick={() => { void copy() }}>
          {copied ? <CheckCheck size={17} /> : <Copy size={17} />}{copied ? '초대 링크를 복사했어요' : '초대 링크 복사'}
        </button>
        <p className="dialog-small">다른 기기에서 접속하려면 LAN 실행 또는 HTTPS 배포가 필요해요. localhost 링크는 이 컴퓨터에서만 열려요.</p>
      </>}
    </Dialog>
  )
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="모여극장에 오신 걸 환영해요" onClose={onClose}>
      <p className="dialog-description">화면은 앞에, 우리는 함께.<br />작은 픽셀 극장에서 더 가까운 만남을 시작해요.</p>
      <div className="help-item"><span>01</span><div><strong>마음에 드는 자리에 앉아요</strong><p>비어 있는 좌석을 누르면 내 캐릭터가 이동해요.</p></div></div>
      <div className="help-item"><span>02</span><div><strong>발표에 마음을 보태요</strong><p>아래 이모지를 누르면 내 자리에서 리액션이 떠올라요.</p></div></div>
      <div className="help-item"><span>03</span><div><strong>궁금하면, 손을 들거나 질문해요</strong><p>공개 질문은 캐릭터 머리 위에 12초간 떠올라요. 좋은 질문에는 공감! 비공개 AI 질문은 나만 볼 수 있어요.</p></div></div>
      <div className="help-item"><span>04</span><div><strong>큰 화면으로 함께 봐요</strong><p>방을 처음 연 사람이 발표자예요. 화면·창·탭을 공유하고, 집중 모드로 더 크게 볼 수 있어요.</p></div></div>
      <div className="shortcut-list"><span><kbd>H</kbd> 손들기</span><span><kbd>Q</kbd> 질문하기</span><span><kbd>F</kbd> 화면 집중</span><span><kbd>1</kbd>–<kbd>6</kbd> 리액션</span></div>
      <p className="dialog-small">음성 통화·녹화 기능은 없어요. 화면 공유 소리는 브라우저에서 선택한 탭/시스템 오디오만 전달돼요. 모든 새 방의 예시 관객 8명과 질문 3개는 실제 참여자가 아니에요.</p>
      <button className="primary-button full-width" onClick={onClose}>좋아요, 함께해요 <span>✦</span></button>
    </Dialog>
  )
}

export function TitleDialog({ title, onSave, onClose }: {
  title: string; onSave: (title: string) => Promise<boolean>; onClose: () => void
}) {
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  return (
    <Dialog title="우리의 이야기에 이름 붙이기" onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!value.trim() || saving) return
        setSaving(true)
        void onSave(value.trim()).then((success) => {
          setSaving(false)
          if (success) onClose()
        })
      }}>
        <label className="field-label" htmlFor="room-title">미팅룸 이름</label>
        <input className="text-input" id="room-title" value={value} maxLength={60} required
          onChange={(event) => setValue(event.target.value)} />
        <button className="primary-button full-width" disabled={!value.trim() || saving}>이름 저장하기</button>
      </form>
    </Dialog>
  )
}
