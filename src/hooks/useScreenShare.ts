import { useCallback, useEffect, useRef, useState } from 'react'
import { emitWithAck, errorMessage } from '../lib/socket.ts'
import { isLivePresentation, type IceCandidate, type PresentationSource, type RoomSnapshot, type ServerToClientEvents } from '../shared/protocol.ts'
import type { RoomSocket } from './useRoom.ts'

export function useScreenShare(
  socket: RoomSocket,
  room: RoomSnapshot | null,
  myId: string,
  reportError: (message: string) => void,
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [busy, setBusy] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const roomRef = useRef(room)
  const peers = useRef(new Map<string, RTCPeerConnection>())
  const pendingIce = useRef(new Map<string, IceCandidate[]>())

  useEffect(() => { roomRef.current = room }, [room])

  const clearConnections = useCallback(() => {
    peers.current.forEach((peer) => peer.close())
    peers.current.clear()
    pendingIce.current.clear()
    setRemoteStream(null)
  }, [])

  const clearLocalStream = useCallback(() => {
    localRef.current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    localRef.current = null
    setLocalStream(null)
  }, [])

  const stopSharing = useCallback(async () => {
    clearLocalStream()
    clearConnections()
    if (socket.connected && roomRef.current?.hostId === socket.id) {
      try {
        await emitWithAck((ack) => socket.emit('presentation:set', { source: 'slides' }, ack))
      } catch (error) {
        reportError(errorMessage(error))
      }
    }
  }, [socket, clearLocalStream, clearConnections, reportError])

  const shareStream = useCallback(async (
    stream: MediaStream,
    source: Exclude<PresentationSource, 'slides'>,
    expectedRoomId: string,
  ) => {
    setBusy(true)
    setScreenError(null)
    try {
      const currentRoom = roomRef.current
      if (!socket.connected || !currentRoom || currentRoom.hostId !== socket.id
        || currentRoom.id !== expectedRoomId) {
        throw new Error('연결 또는 발표자가 변경되었어요. 화면을 다시 선택해 주세요.')
      }
      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack || videoTrack.readyState !== 'live') {
        throw new Error('선택한 화면이 종료되었어요. 다른 창을 선택해 주세요.')
      }
      if (source === 'teams') stream.getAudioTracks().forEach((track) => {
        track.stop()
        stream.removeTrack(track)
      })
      clearLocalStream()
      clearConnections()
      localRef.current = stream
      setLocalStream(stream)
      videoTrack.onended = () => { void stopSharing() }
      await emitWithAck((ack) => socket.emit('presentation:set', { source }, ack))
    } catch (error) {
      stream.getTracks().forEach((track) => { track.onended = null; track.stop() })
      if (localRef.current === stream) clearLocalStream()
      clearConnections()
      throw error
    } finally {
      setBusy(false)
    }
  }, [socket, clearLocalStream, clearConnections, stopSharing])

  const startSharing = useCallback(async () => {
    const expectedRoomId = roomRef.current?.id
    if (!socket.connected || roomRef.current?.hostId !== socket.id || !expectedRoomId) {
      reportError('발표자만 화면을 공유할 수 있어요.')
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      reportError('화면 공유에는 데스크톱 브라우저와 HTTPS 또는 localhost 접속이 필요해요.')
      return
    }
    setBusy(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      await shareStream(stream, 'screen', expectedRoomId)
    } catch (error) {
      reportError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '화면 공유가 취소되었거나 권한이 허용되지 않았어요.'
        : errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [socket, reportError, shareStream])

  const retry = useCallback(async () => {
    setScreenError(null)
    try {
      await emitWithAck((ack) => socket.emit('rtc:ready', ack))
    } catch (error) {
      setScreenError(errorMessage(error))
    }
  }, [socket])

  useEffect(() => {
    const sendSignal = async (to: string, data: Parameters<ServerToClientEvents['rtc:signal']>[0]) => {
      await emitWithAck((ack) => socket.emit('rtc:signal', {
        to, description: data.description, candidate: data.candidate,
      }, ack))
    }

    const createPeer = (id: string) => {
      peers.current.get(id)?.close()
      const peer = new RTCPeerConnection()
      peers.current.set(id, peer)
      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        void sendSignal(id, {
          from: socket.id ?? '',
          candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate },
        }).catch((error: unknown) => {
          if (isLivePresentation(roomRef.current?.presentation.source)) {
            setScreenError(errorMessage(error))
          }
        })
      }
      peer.ontrack = (event) => {
        const stream = event.streams[0]
        if (stream) {
          setRemoteStream(stream)
          setScreenError(null)
        }
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') {
          setScreenError('발표 화면 연결에 실패했어요. 같은 네트워크에서 다시 시도해 주세요.')
        }
      }
      return peer
    }

    const flushIce = async (id: string, peer: RTCPeerConnection) => {
      const candidates = pendingIce.current.get(id) ?? []
      pendingIce.current.delete(id)
      for (const candidate of candidates) await peer.addIceCandidate(candidate)
    }

    const onViewer = async ({ viewerId }: { viewerId: string }) => {
      const stream = localRef.current
      if (!stream || roomRef.current?.hostId !== socket.id) return
      try {
        const peer = createPeer(viewerId)
        stream.getTracks().forEach((track) => peer.addTrack(track, stream))
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        if (!offer.sdp) throw new Error('공유 화면의 연결 정보를 만들지 못했어요.')
        await sendSignal(viewerId, {
          from: socket.id ?? '',
          description: { type: 'offer', sdp: offer.sdp },
        })
      } catch (error) {
        setScreenError(errorMessage(error))
      }
    }

    const onSignal: ServerToClientEvents['rtc:signal'] = async ({ from, description, candidate }) => {
      try {
        let peer = peers.current.get(from)
        if (description?.type === 'offer') {
          peer = createPeer(from)
          await peer.setRemoteDescription(description)
          await flushIce(from, peer)
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          if (!answer.sdp) throw new Error('발표 화면의 연결 정보를 만들지 못했어요.')
          await sendSignal(from, {
            from: socket.id ?? '',
            description: { type: 'answer', sdp: answer.sdp },
          })
        } else if (description && peer) {
          await peer.setRemoteDescription(description)
          await flushIce(from, peer)
        }
        if (candidate) {
          if (peer?.remoteDescription) await peer.addIceCandidate(candidate)
          else pendingIce.current.set(from, [...(pendingIce.current.get(from) ?? []), candidate])
        }
      } catch (error) {
        setScreenError(errorMessage(error))
      }
    }

    socket.on('rtc:viewer', onViewer)
    socket.on('rtc:signal', onSignal)
    const onDisconnect = () => {
      clearConnections()
      clearLocalStream()
    }
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('rtc:viewer', onViewer)
      socket.off('rtc:signal', onSignal)
      socket.off('disconnect', onDisconnect)
      clearConnections()
      clearLocalStream()
    }
  }, [socket, clearConnections, clearLocalStream])

  const source = room?.presentation.source
  const presenterId = room?.presentation.presenterId
  useEffect(() => {
    setScreenError(null)
    if (!isLivePresentation(source)) {
      clearConnections()
      clearLocalStream()
      return
    }
    if (presenterId !== myId && myId) {
      clearLocalStream()
      void retry()
    }
  }, [source, presenterId, myId, retry, clearConnections, clearLocalStream])

  useEffect(() => {
    if (screenError && presenterId === myId) reportError(screenError)
  }, [screenError, presenterId, myId, reportError])

  useEffect(() => {
    const present = new Set(room?.participants.map((participant) => participant.id))
    peers.current.forEach((peer, id) => {
      if (!present.has(id)) {
        peer.close()
        peers.current.delete(id)
        pendingIce.current.delete(id)
      }
    })
  }, [room?.participants])

  useEffect(() => {
    if (!isLivePresentation(source) || presenterId === myId || remoteStream) return
    const timeout = window.setTimeout(() => {
      setScreenError('발표 화면을 기다리고 있어요. 연결이 오래 걸리면 다시 연결해 주세요.')
    }, 15_000)
    return () => window.clearTimeout(timeout)
  }, [source, presenterId, myId, remoteStream])

  return {
    stream: localStream ?? remoteStream,
    isLocal: Boolean(localStream),
    busy, screenError, startSharing, stopSharing, retry,
    shareTeams: (stream: MediaStream, expectedRoomId: string) => shareStream(stream, 'teams', expectedRoomId),
  }
}
