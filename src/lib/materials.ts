import { MATERIAL_MIME_TYPES, MAX_MATERIAL_BYTES, MAX_MATERIALS, type RoomMaterial } from '../shared/protocol.ts'

export function validateMaterialFiles(files: File[]): string | null {
  if (files.length > MAX_MATERIALS) return `자료는 최대 ${MAX_MATERIALS}개까지 선택할 수 있어요.`
  for (const file of files) {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!MATERIAL_MIME_TYPES[extension]) return `${file.name}: 지원하지 않는 파일 형식이에요.`
    if (!file.size) return `${file.name}: 비어 있는 파일은 올릴 수 없어요.`
    if (file.size > MAX_MATERIAL_BYTES) return `${file.name}: 파일 하나는 10MB 이하여야 해요.`
    if (file.name.length > 180 || /[/\\\u0000-\u001f\u007f]/u.test(file.name)) return '파일 이름이 너무 길거나 허용되지 않는 문자가 있어요.'
  }
  return null
}

async function checkResponse(response: Response): Promise<Response> {
  if (response.ok) return response
  const body: unknown = await response.json()
  const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error : `자료 요청에 실패했어요. (${response.status})`
  throw new Error(message)
}

export async function uploadMaterial(roomId: string, accessToken: string, file: File, signal?: AbortSignal) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/materials?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  })
  await checkResponse(response)
}

export async function downloadMaterial(material: RoomMaterial, accessToken: string) {
  const response = await checkResponse(await fetch(material.contentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }))
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = material.name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function formatFileSize(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}
