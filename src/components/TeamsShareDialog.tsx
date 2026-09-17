import { useEffect, useRef, useState } from 'react'
import { AppWindow, Check, LoaderCircle, MonitorUp, ShieldCheck, VolumeX } from 'lucide-react'
import { Dialog } from './Dialog.tsx'
import { errorMessage } from '../lib/socket.ts'
import './TeamsShareDialog.css'

function stopCapture(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    track.onended = null
    track.stop()
  })
}

export function TeamsShareDialog({ canShare, onStart, onClose }: {
  canShare: boolean
  onStart: (stream: MediaStream) => Promise<void>
  onClose: () => void
}) {
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsPlay, setNeedsPlay] = useState(false)
  const capture = useRef<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const requestId = useRef(0)
  const allowed = useRef(canShare)

  useEffect(() => {
    allowed.current = canShare
    if (!canShare) {
      requestId.current += 1
      stopCapture(capture.current)
      capture.current = null
      setPreview(null)
      setBusy(false)
      setError('연결 또는 발표자 권한이 변경되었어요. 다시 연결한 후 선택해 주세요.')
    }
  }, [canShare])

  useEffect(() => () => {
    requestId.current += 1
    stopCapture(capture.current)
    capture.current = null
  }, [])

  useEffect(() => {
    const element = video.current
    if (!element || !preview) return
    let active = true
    element.srcObject = preview
    void element.play().catch(() => { if (active) setNeedsPlay(true) })
    return () => { active = false; element.srcObject = null }
  }, [preview])

  const selectWindow = async () => {
    if (!allowed.current || busy) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('데스크톱 Edge/Chrome에서 HTTPS 또는 localhost로 접속해 주세요. 이 환경에서는 창 공유를 시작할 수 없어요.')
      return
    }
    const id = ++requestId.current
    stopCapture(capture.current)
    capture.current = null
    setPreview(null)
    setNeedsPlay(false)
    setError(null)
    setBusy(true)
    try {
      const options: DisplayMediaStreamOptions & {
        selfBrowserSurface: 'exclude'
        monitorTypeSurfaces: 'exclude'
      } = {
        video: { displaySurface: 'window', frameRate: { ideal: 20, max: 30 } },
        audio: false,
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'exclude',
      }
      const stream = await navigator.mediaDevices.getDisplayMedia(options)
      if (id !== requestId.current || !allowed.current) {
        stopCapture(stream)
        return
      }
      capture.current = stream
      stream.getAudioTracks().forEach((track) => { track.stop(); stream.removeTrack(track) })
      const track = stream.getVideoTracks()[0]
      if (!track || track.readyState !== 'live') throw new Error('선택한 창의 영상을 가져오지 못했어요. 다시 선택해 주세요.')
      if (track.getSettings().displaySurface === 'monitor') {
        throw new Error('전체 화면 대신 Teams 회의 창이나 Teams 탭을 선택해 주세요.')
      }
      track.onended = () => {
        stopCapture(capture.current)
        capture.current = null
        setPreview(null)
        setError('선택한 창의 공유가 종료되었어요. 창을 다시 선택해 주세요.')
      }
      setPreview(stream)
    } catch (captureError) {
      if (id !== requestId.current) return
      stopCapture(capture.current)
      capture.current = null
      setError(captureError instanceof DOMException && captureError.name === 'NotAllowedError'
        ? '창 선택이 취소되었거나 공유 권한이 차단되었어요. 권한을 확인한 뒤 다시 선택해 주세요.'
        : errorMessage(captureError))
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }

  const start = async () => {
    const stream = capture.current
    if (!stream || busy || !allowed.current) return
    setBusy(true)
    setError(null)
    // Confirmation transfers capture ownership to the room, so closing this dialog cannot stop the live share.
    capture.current = null
    try {
      await onStart(stream)
      onClose()
    } catch (shareError) {
      stopCapture(stream)
      setPreview(null)
      setError(errorMessage(shareError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Teams 발표를 극장으로" onClose={onClose} className="teams-share-dialog">
      <p className="dialog-description">Teams 회의 창을 <strong>실시간 영상</strong>으로 보내요.<br />미리보기를 확인하고 시작하기 전까지는 나에게만 보여요.</p>
      <ol className="teams-share-steps">
        <li><span>1</span><div><strong>Teams에서 회의에 참여하세요</strong><p>발표 화면이 보이는 회의 창을 열어 두세요.</p></div></li>
        <li><span>2</span><div><strong>아래 버튼으로 Teams 창을 선택하세요</strong><p>브라우저 선택창에서 Teams 창 또는 탭을 직접 골라요.</p></div></li>
        <li><span>3</span><div><strong>화면을 확인하고 공유를 시작하세요</strong><p>메신저·알림 등 원치 않는 내용이 없는지 확인해 주세요.</p></div></li>
      </ol>
      <div className="teams-capture-preview">
        {preview ? <>
          <video ref={video} autoPlay muted playsInline data-testid="teams-preview" aria-label="Teams 창 미리보기"
            onError={() => setError('미리보기를 재생하지 못했어요. 다른 창을 선택해 주세요.')} />
          <span className="teams-preview-badge">나에게만 보이는 미리보기</span>
          {needsPlay && <button className="screen-play" onClick={() => {
            void video.current?.play().then(() => setNeedsPlay(false)).catch(() => setError('영상을 재생하지 못했어요. 창을 다시 선택해 주세요.'))
          }}>미리보기 재생</button>}
        </> : <div className="teams-preview-placeholder"><AppWindow size={32} /><span>아직 공유 중이 아니에요</span><small>Teams 창을 선택하면 여기에 미리보기가 나타나요.</small></div>}
      </div>
      <div className="teams-share-facts"><span><VolumeX size={14} /> 음성은 Teams에서</span><span><ShieldCheck size={14} /> 녹화·저장 안 함</span></div>
      {error && <p className="teams-share-error" role="alert">{error}</p>}
      <button className="secondary-button full-width" onClick={() => { void selectWindow() }} disabled={busy || !canShare}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <AppWindow size={16} />}
        {busy ? '연결 준비 중…' : preview ? '다른 Teams 창 선택' : 'Teams 창 선택'}
      </button>
      {preview && <button className="primary-button full-width" onClick={() => { void start() }} disabled={busy || !canShare}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <MonitorUp size={16} />} 이 화면을 극장에 공유
      </button>}
      <p className="teams-share-note"><Check size={13} /> 직접 고른 창을 전송하는 방식이며 Teams API 자동 연동은 아니에요. Teams 창을 최소화하지 말고, 모여극장 자체를 선택하지 마세요.</p>
    </Dialog>
  )
}
