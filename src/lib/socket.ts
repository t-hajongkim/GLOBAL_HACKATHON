import type { Ack } from '../shared/protocol.ts'

export function emitWithAck<T>(emit: (ack: Ack<T>) => void, timeoutMs = 7_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('응답이 늦어지고 있어요. 연결 상태를 확인하고 다시 시도해 주세요.'))
    }, timeoutMs)

    emit((result) => {
      window.clearTimeout(timeout)
      if (result.ok) resolve(result.data)
      else reject(new Error(result.error))
    })
  })
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.'
}

export function newRoomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
