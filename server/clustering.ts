import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { QuestionCluster } from '../src/shared/protocol.js'

export interface ClusterQuestion {
  id: string
  text: string
  votes: number
}

// Above this count we skip the LLM to bound token usage and latency.
const MAX_AI_QUESTIONS = 40
const AI_TIMEOUT_MS = 9_000
const SIMILARITY_THRESHOLD = 0.2

interface AzureConfig {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
}

function azureConfig(): AzureConfig | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim()
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim()
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim()
  if (!endpoint || !apiKey || !deployment) return null
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-08-01-preview'
  return { endpoint, apiKey, deployment, apiVersion }
}

export function isAiClusteringConfigured(): boolean {
  return azureConfig() !== null
}

/** Groups semantically similar audience questions. Uses Azure OpenAI when
 *  configured, otherwise a local character-bigram similarity heuristic. */
export async function clusterQuestions(questions: ClusterQuestion[]): Promise<QuestionCluster[]> {
  const config = azureConfig()
  if (config && questions.length <= MAX_AI_QUESTIONS) {
    try {
      const clusters = await clusterWithAzure(config, questions)
      if (clusters) return clusters
    } catch (error) {
      console.error('AI 질문 묶기에 실패해 기본 방식으로 전환합니다:', error)
    }
  }
  return clusterByKeyword(questions)
}

const groupsSchema = z
  .object({
    groups: z
      .array(
        z
          .object({ label: z.string(), questionIds: z.array(z.string()) })
          .strict(),
      )
      .max(64),
  })
  .strict()

async function clusterWithAzure(
  config: AzureConfig,
  questions: ClusterQuestion[],
): Promise<QuestionCluster[] | null> {
  const url = `${config.endpoint.replace(/\/$/, '')}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'api-key': config.apiKey },
      body: JSON.stringify({
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '당신은 실시간 발표 Q&A 도우미입니다. 비슷한 주제의 청중 질문을 묶고, 각 묶음에 20자 이내의 짧은 한국어 라벨을 붙입니다. 반드시 JSON만 응답합니다.',
          },
          {
            role: 'user',
            content:
              '다음 질문들을 의미가 비슷한 것끼리 묶어 주세요. 각 질문은 정확히 하나의 묶음에만 넣고, 모든 id를 포함하세요. ' +
              '형식: {"groups":[{"label":"짧은 주제","questionIds":["id"]}]}\n\n' +
              JSON.stringify(questions.map((question) => ({ id: question.id, text: question.text }))),
          },
        ],
      }),
    })
    if (!response.ok) {
      throw new Error(`Azure OpenAI 응답 오류: ${response.status}`)
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = groupsSchema.safeParse(JSON.parse(content))
    if (!parsed.success) return null
    return assembleClusters(questions, parsed.data.groups, true)
  } finally {
    clearTimeout(timeout)
  }
}

function assembleClusters(
  questions: ClusterQuestion[],
  groups: { label: string; questionIds: string[] }[],
  aiGenerated: boolean,
): QuestionCluster[] {
  const byId = new Map(questions.map((question) => [question.id, question]))
  const assigned = new Set<string>()
  const clusters: QuestionCluster[] = []
  for (const group of groups) {
    const members = group.questionIds.filter((id) => byId.has(id) && !assigned.has(id))
    if (members.length === 0) continue
    members.forEach((id) => assigned.add(id))
    clusters.push(makeCluster(group.label, members, byId, aiGenerated))
  }
  // Any question the model omitted becomes its own group so nothing is dropped.
  for (const question of questions) {
    if (!assigned.has(question.id)) {
      clusters.push(makeCluster(keywordLabel([question]), [question.id], byId, aiGenerated))
    }
  }
  return sortClusters(clusters)
}

function makeCluster(
  label: string,
  memberIds: string[],
  byId: Map<string, ClusterQuestion>,
  aiGenerated: boolean,
): QuestionCluster {
  const votes = memberIds.reduce((sum, id) => sum + (byId.get(id)?.votes ?? 0), 0)
  const cleaned = label.trim().slice(0, 40)
  const members = memberIds.map((id) => byId.get(id)).filter((question): question is ClusterQuestion => question !== undefined)
  return {
    id: randomUUID(),
    label: cleaned || keywordLabel(members),
    questionIds: memberIds,
    votes,
    aiGenerated,
  }
}

function sortClusters(clusters: QuestionCluster[]): QuestionCluster[] {
  return clusters.sort(
    (a, b) => b.questionIds.length - a.questionIds.length || b.votes - a.votes,
  )
}

// --- Local fallback: character-bigram Jaccard similarity ---

function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^0-9a-z가-힣]+/g, '')
  const grams = new Set<string>()
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2))
  }
  if (grams.size === 0 && normalized.length === 1) grams.add(normalized)
  return grams
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return shared / (a.size + b.size - shared)
}

function clusterByKeyword(questions: ClusterQuestion[]): QuestionCluster[] {
  const seeds = [...questions].sort((a, b) => b.votes - a.votes)
  const grams = new Map(questions.map((question) => [question.id, bigrams(question.text)]))
  const byId = new Map(questions.map((question) => [question.id, question]))
  const assigned = new Set<string>()
  const clusters: QuestionCluster[] = []
  for (const seed of seeds) {
    if (assigned.has(seed.id)) continue
    assigned.add(seed.id)
    const memberIds = [seed.id]
    const seedGrams = grams.get(seed.id)!
    for (const candidate of seeds) {
      if (assigned.has(candidate.id)) continue
      if (similarity(seedGrams, grams.get(candidate.id)!) >= SIMILARITY_THRESHOLD) {
        assigned.add(candidate.id)
        memberIds.push(candidate.id)
      }
    }
    const members = memberIds.map((id) => byId.get(id)!)
    clusters.push(makeCluster(keywordLabel(members), memberIds, byId, false))
  }
  return sortClusters(clusters)
}

const STOPWORDS = new Set([
  '그', '이', '저', '것', '수', '등', '및', '좀', '더', '수요', '무엇', '어떻게', '어떤',
  '왜', '언제', '어디', '있을까요', '있나요', '궁금해요', '궁금합니다', '좋을까요', '까요',
  '어떻', '하면', '해서', '대해', '대한', '통해', '위해', '있는', '하는', '되는',
])

function keywordLabel(members: ClusterQuestion[]): string {
  const counts = new Map<string, number>()
  for (const member of members) {
    const words = member.text
      .toLowerCase()
      .split(/[^0-9a-z가-힣]+/)
      .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    for (const word of new Set(words)) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (top) return top
  const fallback = members[0]?.text.trim() ?? '질문 묶음'
  return fallback.length > 18 ? `${fallback.slice(0, 18)}…` : fallback
}
