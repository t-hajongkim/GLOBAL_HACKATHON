import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { AiConfigError, AiRequestError, answerQuestion, loadAiConfig } from './ai.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('loadAiConfig falls back to defaults and accepts GITHUB_TOKEN as a key', () => {
  const config = loadAiConfig({ GITHUB_TOKEN: 'gh-token' } as NodeJS.ProcessEnv)
  assert.equal(config.apiKey, 'gh-token')
  assert.equal(config.baseUrl, 'https://models.github.ai/inference')
  assert.equal(config.model, 'openai/gpt-4o-mini')
})

test('loadAiConfig prefers AI_API_KEY over GITHUB_TOKEN and trims a trailing slash from the base URL', () => {
  const config = loadAiConfig({
    AI_API_KEY: 'explicit-key',
    GITHUB_TOKEN: 'gh-token',
    AI_API_BASE_URL: 'https://example.test/v1/',
    AI_MODEL: 'custom-model',
  } as NodeJS.ProcessEnv)
  assert.equal(config.apiKey, 'explicit-key')
  assert.equal(config.baseUrl, 'https://example.test/v1')
  assert.equal(config.model, 'custom-model')
})

test('answerQuestion rejects without an API key, without calling the network', async () => {
  let called = false
  globalThis.fetch = (() => { called = true; throw new Error('should not be called') }) as typeof fetch
  await assert.rejects(
    () => answerQuestion('', 'hello?', { baseUrl: 'https://example.test', apiKey: undefined, model: 'm' }),
    AiConfigError,
  )
  assert.equal(called, false)
})

test('answerQuestion sends the room context in the system prompt and returns the model answer', async () => {
  let capturedBody: unknown
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string)
    return new Response(JSON.stringify({ choices: [{ message: { content: '  42입니다  ' } }] }), { status: 200 })
  }) as typeof fetch

  const answer = await answerQuestion('행사 자료: 답은 42.', '답이 뭐야?', {
    baseUrl: 'https://example.test',
    apiKey: 'key',
    model: 'test-model',
  })

  assert.equal(answer, '42입니다')
  const body = capturedBody as { model: string; messages: { role: string; content: string }[] }
  assert.equal(body.model, 'test-model')
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /행사 자료: 답은 42\./)
  assert.deepEqual(body.messages[1], { role: 'user', content: '답이 뭐야?' })
})

test('answerQuestion uses a fallback system prompt when no context has been shared yet', async () => {
  let capturedBody: unknown
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'answer' } }] }), { status: 200 })
  }) as typeof fetch

  await answerQuestion('   ', 'question', { baseUrl: 'https://example.test', apiKey: 'key', model: 'm' })
  const body = capturedBody as { messages: { role: string; content: string }[] }
  assert.match(body.messages[0].content, /아직 발표자가 이 공간에 자료나 배경 정보를 전달하지 않았습니다/)
})

test('answerQuestion raises a request error on a non-ok response', async () => {
  globalThis.fetch = (async () => new Response('bad request detail', { status: 400 })) as typeof fetch
  await assert.rejects(
    () => answerQuestion('ctx', 'q', { baseUrl: 'https://example.test', apiKey: 'key', model: 'm' }),
    AiRequestError,
  )
})

test('answerQuestion raises a request error on an empty completion', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as typeof fetch
  await assert.rejects(
    () => answerQuestion('ctx', 'q', { baseUrl: 'https://example.test', apiKey: 'key', model: 'm' }),
    AiRequestError,
  )
})
