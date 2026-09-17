export const AVATARS = ['mint', 'lilac', 'peach', 'sky', 'sunflower', 'rose'] as const
export type AvatarColor = (typeof AVATARS)[number]

export const REACTIONS = ['👏', '❤️', '👍', '😂', '🎉', '💡'] as const
export type ReactionEmoji = (typeof REACTIONS)[number]

export const SEAT_COUNT = 24
export const SLIDE_COUNT = 4
export const MAX_QUESTION_LENGTH = 280
export const MAX_CONTEXT_LENGTH = 20_000
export const MAX_AI_QUESTION_LENGTH = 500
export const DEFAULT_ROOM_TITLE = '작은 아이디어, 큰 만남'
export const JOIN_ROLES = ['host', 'attendee'] as const
export type JoinRole = (typeof JOIN_ROLES)[number]
export const MAX_MATERIALS = 5
export const MAX_MATERIAL_BYTES = 10 * 1024 * 1024
export const MATERIAL_MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export interface RoomMaterial {
  id: string
  roomId: string
  name: string
  mimeType: string
  size: number
  sha256: string
  createdAt: number
  uploadedBy: string
  contentUrl: string
}
// Minimum pending questions before the AI grouping view surfaces.
export const CLUSTER_MIN_QUESTIONS = 3

export interface Participant {
  id: string
  name: string
  avatar: AvatarColor
  seat: number | null
  position: { x: number; y: number }
  handRaised: boolean
  joinedAt: number
  isDemo: boolean
}

export interface Question {
  id: string
  authorId: string
  authorName: string
  avatar: AvatarColor
  text: string
  createdAt: number
  votes: string[]
  answered: boolean
  isDemo: boolean
}

export interface QuestionCluster {
  id: string
  label: string
  questionIds: string[]
  votes: number
  aiGenerated: boolean
}

export const PRESENTATION_SOURCES = ['slides', 'screen', 'teams'] as const
export type PresentationSource = (typeof PRESENTATION_SOURCES)[number]

export function isLivePresentation(source: PresentationSource | undefined): boolean {
  return source === 'screen' || source === 'teams'
}

export interface Presentation {
  source: PresentationSource
  slide: number
  presenterId: string | null
}

export interface RoomSnapshot {
  id: string
  title: string
  isDemo: boolean
  createdAt: number
  hostId: string
  participants: Participant[]
  questions: Question[]
  materials: RoomMaterial[]
  clusters: QuestionCluster[]
  presentation: Presentation
}

export interface RoomJoinResult extends RoomSnapshot {
  accessToken: string
  role: JoinRole
}

export interface Reaction {
  id: string
  participantId: string
  emoji: ReactionEmoji
  createdAt: number
}

export interface JoinRoom {
  roomId: string
  name: string
  avatar: AvatarColor
  demo: boolean
  role: JoinRole
  title?: string
}

export interface SessionDescription {
  type: 'offer' | 'answer'
  sdp: string
}

export interface IceCandidate {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface SignalPayload {
  to: string
  description?: SessionDescription
  candidate?: IceCandidate
}

export type Acknowledgement<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type Ack<T = undefined> = (result: Acknowledgement<T>) => void

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoom, ack: Ack<RoomJoinResult>) => void
  'room:leave': (ack: Ack) => void
  'room:profile': (payload: { name: string; avatar: AvatarColor }, ack: Ack) => void
  'room:seat': (payload: { seat: number }, ack: Ack) => void
  'room:move': (payload: { x: number; y: number }, ack: Ack) => void
  'room:hand': (payload: { raised: boolean }, ack: Ack) => void
  'room:reaction': (payload: { emoji: ReactionEmoji }, ack: Ack) => void
  'question:add': (payload: { text: string }, ack: Ack) => void
  'question:vote': (payload: { questionId: string }, ack: Ack) => void
  'question:answer': (payload: { questionId: string }, ack: Ack) => void
  'presentation:set': (payload: Partial<Pick<Presentation, 'source' | 'slide'>>, ack: Ack) => void
  'room:title': (payload: { title: string }, ack: Ack) => void
  'room:context': (payload: { context: string }, ack: Ack) => void
  'ai:ask': (payload: { question: string }, ack: Ack<{ answer: string }>) => void
  'rtc:ready': (ack: Ack) => void
  'rtc:signal': (payload: SignalPayload, ack: Ack) => void
}

export interface ServerToClientEvents {
  'room:state': (room: RoomSnapshot) => void
  'room:reaction': (reaction: Reaction) => void
  'room:error': (message: string) => void
  'rtc:viewer': (payload: { viewerId: string }) => void
  'rtc:signal': (payload: Omit<SignalPayload, 'to'> & { from: string }) => void
}
