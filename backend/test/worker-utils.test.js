import assert from 'node:assert/strict'
import test from 'node:test'

import { __test } from '../src/worker.js'

const env = {
  CRESCO_TOKEN_SECRET: 'worker-token-secret-used-only-by-unit-tests',
  CRESCO_ENCRYPTION_KEY: 'worker-encryption-secret-used-only-by-unit-tests',
  CRESCO_PASSWORD_PEPPER: 'worker-password-pepper-used-only-by-unit-tests',
}

test('worker base64url encoding round-trips bytes', () => {
  const input = Uint8Array.from([0, 1, 2, 127, 128, 254, 255])
  assert.deepEqual(__test.base64UrlToBytes(__test.bytesToBase64Url(input)), input)
})

test('worker normalizes providers and money safely', () => {
  assert.equal(__test.providerKey('fal.ai · ByteDance'), 'fal.ai')
  assert.equal(__test.providerKey('BytePlus ModelArk'), 'byteplus')
  assert.equal(__test.providerKey('OpenAI'), 'openai')
  assert.equal(__test.toNanoUsd(0.62), 620000000)
  assert.equal(__test.toNanoUsd(-1), null)
})

test('worker password hashes verify without storing plaintext', async () => {
  const hash = await __test.hashPassword('correct horse battery staple', env)
  assert.match(hash, /^hmac-sha256:/)
  assert.equal(hash.includes('correct horse'), false)
  assert.equal(await __test.verifyPassword('correct horse battery staple', hash, env), true)
  assert.equal(await __test.verifyPassword('incorrect password', hash, env), false)
})

test('worker credential encryption round-trips with AES-GCM', async () => {
  const encrypted = await __test.encryptSecret('provider-secret-value', env)
  assert.equal(encrypted.includes('provider-secret-value'), false)
  assert.equal(await __test.decryptSecret(encrypted, env), 'provider-secret-value')
})

test('worker session tokens are signed and readable', async () => {
  const user = { id: 'user-1', role: 'admin', sessionVersion: 3 }
  const token = await __test.signToken(user, env)
  const claims = await __test.verifyToken(token, env)
  assert.equal(claims.sub, user.id)
  assert.equal(claims.role, user.role)
  assert.equal(claims.sv, user.sessionVersion)
  assert.equal(await __test.verifyToken(`${token}tampered`, env), null)
  assert.equal(await __test.verifyToken('not-valid-base64.%%%%', env), null)
})

test('worker finds common provider result URLs', () => {
  assert.equal(__test.resultUrl({ images: [{ url: 'https://example.com/image.png' }] }), 'https://example.com/image.png')
  assert.equal(__test.resultUrl({ video: { url: 'https://example.com/video.mp4' } }), 'https://example.com/video.mp4')
})

test('worker extracts safe text output from provider responses', () => {
  assert.equal(__test.providerOutputText({ output_text: 'Direct response' }), 'Direct response')
  assert.equal(__test.providerOutputText({ output: [{ content: [{ type: 'output_text', text: 'Nested response' }] }] }), 'Nested response')
  assert.equal(__test.providerOutputText({}), null)
})

test('worker reads chat completion output', () => {
  assert.equal(__test.providerOutputText({ choices: [{ message: { role: 'assistant', content: 'Chat response' } }] }), 'Chat response')
  assert.equal(__test.providerOutputText({ choices: [{ message: { content: [{ text: 'Part one. ' }, { text: 'Part two.' }] } }] }), 'Part one. Part two.')
  assert.equal(__test.providerOutputText({ choices: [{ message: { content: '' } }] }), null)
})

test('worker gives text generations a longer timeout than polls', () => {
  assert.equal(__test.providerTimeoutMs({}, 'text'), 120000)
  assert.equal(__test.providerTimeoutMs({}, 'text', true), 300000)
  assert.equal(__test.providerTimeoutMs({}, 'video'), 20000)
  assert.equal(__test.providerTimeoutMs({}, 'poll'), 20000)
  assert.equal(__test.providerTimeoutMs({ CRESCO_TEXT_TIMEOUT_MS: '45000' }, 'text'), 45000)
  assert.equal(__test.providerTimeoutMs({ CRESCO_TEXT_TIMEOUT_MS: 'nonsense' }, 'text'), 120000)
})

test('worker builds chat completion bodies with reasoning disabled by default', () => {
  const model = { endpoint: 'glm-5.3-flash' }
  assert.equal(__test.textRequestPath(model), '/chat/completions')
  const body = __test.textRequestBody(model, 'Say hello')
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Say hello' }])
  assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.equal(body.stream, undefined)
  const streamed = __test.textRequestBody(model, 'Say hello', { stream: true })
  assert.equal(streamed.stream, true)
  assert.deepEqual(streamed.stream_options, { include_usage: true })
})

test('worker honours per-model reasoning and endpoint settings', () => {
  const responsesModel = { endpoint: 'glm-5.3-flash', textApi: 'responses', thinkingMode: 'enabled' }
  assert.equal(__test.textRequestPath(responsesModel), '/responses')
  const body = __test.textRequestBody(responsesModel, 'Say hello')
  assert.equal(body.input, 'Say hello')
  assert.deepEqual(body.thinking, { type: 'enabled' })
  assert.equal(__test.textRequestBody({ endpoint: 'x', thinkingMode: 'auto' }, 'hi').thinking, undefined)
})

test('worker reads streamed deltas from both text APIs', () => {
  assert.equal(__test.streamTextDelta({ choices: [{ delta: { content: 'Hel' } }] }), 'Hel')
  assert.equal(__test.streamTextDelta({ choices: [{ delta: { content: [{ text: 'lo' }] } }] }), 'lo')
  assert.equal(__test.streamTextDelta({ type: 'response.output_text.delta', delta: '!' }), '!')
  assert.equal(__test.streamTextDelta({ choices: [{ delta: { reasoning_content: 'thinking' } }] }), '')
})

test('worker turns provider timeouts into a readable code and keeps the raw text', () => {
  const aborted = new Error('The operation was aborted due to timeout')
  aborted.name = 'TimeoutError'
  assert.equal(__test.isTimeoutError(aborted), true)
  const mapped = __test.providerFailure(aborted, 120000)
  assert.equal(mapped.message, 'provider_timeout_after_120s')
  assert.equal(mapped.providerDetail, 'The operation was aborted due to timeout')
  const other = new Error('byteplus_request_failed_404')
  assert.equal(__test.isTimeoutError(other), false)
  assert.equal(__test.providerFailure(other, 120000).message, 'byteplus_request_failed_404')
})

test('worker caps how long a generation may stay queued', () => {
  assert.equal(__test.maxQueuedMs({}, 'text'), 600000)
  assert.equal(__test.maxQueuedMs({}, 'image'), 1200000)
  assert.equal(__test.maxQueuedMs({}, 'video'), 3600000)
  assert.equal(__test.maxQueuedMs({ CRESCO_MAX_QUEUED_MINUTES: '5' }, 'video'), 300000)
  assert.equal(__test.maxQueuedMs({}, 'unknown-kind'), 1800000)
})
