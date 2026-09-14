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
