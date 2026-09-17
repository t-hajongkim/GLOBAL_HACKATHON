import { useState } from 'react'
import { Download, FileText, FolderOpen } from 'lucide-react'
import { Dialog } from './Dialog.tsx'
import { downloadMaterial, formatFileSize } from '../lib/materials.ts'
import { errorMessage } from '../lib/socket.ts'
import type { RoomMaterial } from '../shared/protocol.ts'

export function MaterialsDialog({ materials, accessToken, onClose }: {
  materials: RoomMaterial[]
  accessToken: string
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  return (
    <Dialog title="이 방의 발표 자료" onClose={onClose}>
      <p className="dialog-description">Host가 준비한 원본 자료예요. 참석자와 추후 연결되는 에이전트가 같은 자료를 사용해요.</p>
      {materials.length ? <ul className="room-material-list">{materials.map((material) => (
        <li key={material.id}><FileText size={23} /><div><strong>{material.name}</strong><span>{formatFileSize(material.size)} · 원본 준비됨</span></div>
          <button className="icon-button" aria-label={`${material.name} 다운로드`} disabled={downloading !== null || !accessToken}
            onClick={() => {
              setError(null)
              setDownloading(material.id)
              void downloadMaterial(material, accessToken).catch((downloadError: unknown) => setError(errorMessage(downloadError))).finally(() => setDownloading(null))
            }}><Download size={18} /></button>
        </li>
      ))}</ul> : <div className="materials-empty"><FolderOpen size={32} /><p>아직 업로드된 자료가 없어요.</p></div>}
      {error && <p className="join-error" role="alert">{error}</p>}
      <p className="dialog-small">자료는 현재 방에서만 제공돼요. 모두 퇴장하거나 서버가 종료되면 삭제됩니다. AI 분석·요약 기능은 별도 에이전트로 연결할 예정이에요.</p>
    </Dialog>
  )
}
