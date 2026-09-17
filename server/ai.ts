// OpenAI-compatible chat-completions client for the attendee-facing AI assistant.
// Defaults to GitHub Models' inference endpoint (works with a `models:read`-scoped
// GITHUB_TOKEN/PAT). Point AI_API_BASE_URL/AI_API_KEY/AI_MODEL at a different
// OpenAI-compatible provider (including a Copilot-compatible endpoint, if available
// to you) without any code changes.

const DEFAULT_BASE_URL = 'https://models.github.ai/inference'
const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const REQUEST_TIMEOUT_MS = 20_000

export class AiConfigError extends Error {}
export class AiRequestError extends Error {}

export interface AiConfig {
  baseUrl: string
  apiKey: string | undefined
  model: string
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    baseUrl: (env.AI_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.AI_API_KEY?.trim() || env.GITHUB_TOKEN?.trim() || undefined,
    model: env.AI_MODEL?.trim() || DEFAULT_MODEL,
  }
}

function systemPrompt(context: string): string {
  const trimmed = context.trim()
  if (!trimmed) {
    return [
      '당신은 실시간 발표/이벤트를 듣는 참석자를 돕는 친절한 Q&A 도우미입니다.',
      '아직 발표자가 이 공간에 자료나 배경 정보를 전달하지 않았습니다.',
      '그런 경우, 지금은 답변할 자료가 없다고 정중히 안내하고, 발표자에게 직접 질문하거나',
      '질문 패널에 질문을 남겨 보라고 제안하세요. 답을 추측하거나 지어내지 마세요.',
    ].join(' ')
  }
  return [
    '당신은 실시간 발표/이벤트를 듣는 참석자를 돕는 친절한 Q&A 도우미입니다.',
    '아래는 발표자가 이 공간에 미리 공유한 배경 정보와 자료입니다. 이 정보에 근거해서만 답변하세요.',
    '정보에 없는 내용은 추측하지 말고, 자료에 없다고 솔직히 말한 뒤 발표자에게 직접 질문해 보라고 안내하세요.',
    '답변은 간결하고 이해하기 쉽게, 한국어로 작성하세요.',
    '--- 발표자가 공유한 자료 시작 ---',
    trimmed,
    '--- 발표자가 공유한 자료 끝 ---',
  ].join('\n')
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

export async function answerQuestion(context: string, question: string, config: AiConfig = loadAiConfig()): Promise<string> {
  if (!config.apiKey) {
    throw new AiConfigError('AI 도우미가 아직 설정되지 않았어요. 서버 관리자에게 AI_API_KEY 설정을 요청해 주세요.')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt(context) },
          { role: 'user', content: question },
        ],
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AiRequestError(`AI 서비스 호출에 실패했습니다 (${response.status}). ${detail.slice(0, 200)}`)
    }
    const data = (await response.json()) as ChatCompletionResponse
    const answer = data.choices?.[0]?.message?.content?.trim()
    if (!answer) throw new AiRequestError('AI 서비스가 빈 응답을 반환했습니다.')
    return answer
  } catch (error) {
    if (error instanceof AiConfigError || error instanceof AiRequestError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiRequestError('AI 서비스 응답이 너무 오래 걸려 요청을 취소했습니다. 잠시 후 다시 시도해 주세요.')
    }
    throw new AiRequestError('AI 서비스를 호출하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    clearTimeout(timeout)
  }
}
