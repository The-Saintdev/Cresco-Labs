import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = fileURLToPath(new URL('..', import.meta.url))

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url + '/health')
      if (response.ok) return
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error('API did not become healthy')
}

test('login, authorization, and usage summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cresco-api-'))
  let providerBase = ''
  const providerServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', providerBase || 'http://127.0.0.1')
    const bytePlusRequest = requestUrl.pathname.startsWith('/byteplus/')
    const expectedAuthorization = bytePlusRequest ? 'Bearer byteplus-secret-value' : 'Key provider-secret-value'
    if (request.headers.authorization !== expectedAuthorization) { response.writeHead(401); return response.end('{}') }
    response.setHeader('content-type', 'application/json')
    if (requestUrl.pathname === '/byteplus/responses' && request.method === 'POST') return response.end(JSON.stringify({ id: 'bp-text-1', output_text: 'BytePlus text response' }))
    if (requestUrl.pathname === '/byteplus/contents/generations/tasks' && request.method === 'POST') return response.end(JSON.stringify({ id: 'bp-video-1' }))
    if (requestUrl.pathname === '/byteplus/contents/generations/tasks/bp-video-1') return response.end(JSON.stringify({ id: 'bp-video-1', status: 'succeeded', content: { video_url: 'https://media.example/byteplus.mp4' } }))
    if (request.method === 'POST') return response.end(JSON.stringify({ request_id: 'fal-request-1', status_url: providerBase + '/status', response_url: providerBase + '/result' }))
    if (requestUrl.pathname === '/status') return response.end(JSON.stringify({ status: 'COMPLETED' }))
    if (requestUrl.pathname === '/result') return response.end(JSON.stringify({ video: { url: 'https://media.example/result.mp4' } }))
    if (requestUrl.pathname === '/v1/account/billing') return response.end(JSON.stringify({ username: 'test-team', credits: { current_balance: 24.5, currency: 'USD' } }))
    if (requestUrl.pathname === '/v1/models/billing-events') return response.end(JSON.stringify({ billing_events: [{ request_id: 'fal-request-1', endpoint_id: 'test/video', cost_total: 0.45, cost_estimate_nano_usd: 450000000 }], next_cursor: null, has_more: false }))
    if (requestUrl.pathname === '/v1/models/usage') return response.end(JSON.stringify({ time_series: [{ bucket: new Date().toISOString(), results: [{ endpoint_id: 'test/video', unit: 'video', quantity: 1, cost_total: 0.45, currency: 'USD' }] }], next_cursor: null, has_more: false }))
    response.writeHead(404); response.end('{}')
  })
  await new Promise(resolveListen => providerServer.listen(0, '127.0.0.1', resolveListen))
  providerBase = 'http://127.0.0.1:' + providerServer.address().port
  const port = '8799'
  const baseUrl = 'http://127.0.0.1:' + port
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: port,
      CRESCO_DATA_PATH: join(directory, 'test.json'),
      CRESCO_UPLOAD_PATH: join(directory, 'uploads'),
      CRESCO_TOKEN_SECRET: 'test-secret-at-least-long-enough',
      CRESCO_ENCRYPTION_KEY: 'test-encryption-secret-at-least-long-enough',
      CRESCO_FAL_QUEUE_URL: providerBase,
      CRESCO_FAL_PLATFORM_URL: providerBase + '/v1',
      CRESCO_BYTEPLUS_BASE_URL: providerBase + '/byteplus',
      CRESCO_ADMIN_EMAIL: 'admin@cresco.local',
      CRESCO_ADMIN_PASSWORD: 'test-admin-password',
      CRESCO_MEMBER_EMAIL: 'jamie@cresco.local',
      CRESCO_MEMBER_PASSWORD: 'test-member-password',
    },
    stdio: 'ignore',
  })
  try {
    await waitForHealth(baseUrl)
    const loginResponse = await fetch(baseUrl + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@cresco.local', password: 'test-admin-password', client: 'test' }),
    })
    assert.equal(loginResponse.status, 200)
    const login = await loginResponse.json()
    assert.equal(login.user.role, 'admin')

    const headers = { authorization: 'Bearer ' + login.token }
    const selfDisableResponse = await fetch(baseUrl + '/v1/admin/users/' + login.user.id, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'suspended' }),
    })
    assert.equal(selfDisableResponse.status, 400)
    const usersResponse = await fetch(baseUrl + '/v1/admin/users', { headers })
    const users = await usersResponse.json()
    assert.equal(usersResponse.status, 200)
    assert.equal(users.users.length, 2)

    const createUserResponse = await fetch(baseUrl + '/v1/admin/users', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Member', email: 'new@cresco.local', password: 'temporary-password', status: 'pending' }),
    })
    const createdUser = await createUserResponse.json()
    assert.equal(createUserResponse.status, 201)
    assert.equal(createdUser.user.status, 'pending')
    const approveResponse = await fetch(baseUrl + '/v1/admin/users/' + createdUser.user.id, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }),
    })
    assert.equal(approveResponse.status, 200)

    const createModelResponse = await fetch(baseUrl + '/v1/admin/models', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Video Model', provider: 'fal.ai', kind: 'video', endpoint: 'test/video', apiKey: 'provider-secret-value', priceUsd: 0.5 }),
    })
    const createdModel = await createModelResponse.json()
    assert.equal(createModelResponse.status, 201)
    assert.equal(createdModel.model.status, 'active')
    assert.equal(createdModel.model.credentialConfigured, true)
    assert.equal((await readFile(join(directory, 'test.json'), 'utf8')).includes('provider-secret-value'), false)
    const uploadResponse = await fetch(baseUrl + '/v1/uploads?name=reference.png', {
      method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: Buffer.from('test-image'),
    })
    const uploaded = await uploadResponse.json()
    assert.equal(uploadResponse.status, 201)
    assert.equal(uploaded.upload.fileName, 'reference.png')
    assert.equal(uploaded.upload.storageKey, undefined)
    const falGenerationResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: createdModel.model.id, prompt: 'Generate a test video', options: { aspect: '16:9', quality: '720p' }, referenceIds: [uploaded.upload.id] }),
    })
    const falGeneration = await falGenerationResponse.json()
    assert.equal(falGenerationResponse.status, 202)
    assert.equal(falGeneration.generation.providerRequestId, 'fal-request-1')
    const reconcileResponse = await fetch(baseUrl + '/v1/admin/reconcile', { method: 'POST', headers })
    assert.equal(reconcileResponse.status, 200)
    const reconcile = await reconcileResponse.json()
    assert.equal(reconcile.providerSync.synced, true)
    assert.equal(reconcile.providerSync.balanceNanoUsd, 24500000000)
    assert.equal(reconcile.providerSync.reconciledCosts, 1)
    const completedHistory = await (await fetch(baseUrl + '/v1/history', { headers })).json()
    const completedGeneration = completedHistory.generations.find(item => item.id === falGeneration.generation.id)
    assert.equal(completedGeneration.status, 'complete')
    assert.equal(completedGeneration.resultUrl, 'https://media.example/result.mp4')
    assert.equal(completedGeneration.costNanoUsd, 450000000)
    assert.equal(completedGeneration.costSource, 'provider')
    assert.equal(completedGeneration.result, undefined)
    assert.equal(completedGeneration.providerStatusUrl, undefined)
    assert.equal(completedGeneration.references.length, 1)
    assert.equal(completedGeneration.references[0].fileName, 'reference.png')
    const generationStatusResponse = await fetch(baseUrl + '/v1/generations/' + falGeneration.generation.id, { headers })
    const generationStatus = await generationStatusResponse.json()
    assert.equal(generationStatusResponse.status, 200)
    assert.equal(generationStatus.generation.status, 'complete')
    assert.equal(generationStatus.generation.resultUrl, 'https://media.example/result.mp4')
    const bytePlusTextModelResponse = await fetch(baseUrl + '/v1/admin/models', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'BytePlus Text', provider: 'BytePlus', kind: 'text', endpoint: 'seed-2-0-lite-260228', apiKey: 'byteplus-secret-value', priceUsd: 0 }),
    })
    const bytePlusTextModel = await bytePlusTextModelResponse.json()
    assert.equal(bytePlusTextModelResponse.status, 201)
    assert.equal(bytePlusTextModel.model.adapterConfigured, true)
    assert.equal(bytePlusTextModel.model.executionReady, true)
    const bytePlusTextResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: bytePlusTextModel.model.id, prompt: 'Test direct BytePlus text output.' }),
    })
    const bytePlusText = await bytePlusTextResponse.json()
    assert.equal(bytePlusTextResponse.status, 201)
    assert.equal(bytePlusText.generation.status, 'complete')
    assert.equal(bytePlusText.generation.outputText, 'BytePlus text response')
    assert.equal(bytePlusText.generation.modelProvider, 'BytePlus')
    const bytePlusVideoModelResponse = await fetch(baseUrl + '/v1/admin/models', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'BytePlus Seedance', provider: 'BytePlus', kind: 'video', endpoint: 'dreamina-seedance-2-0-260128', priceUsd: 0 }),
    })
    const bytePlusVideoModel = await bytePlusVideoModelResponse.json()
    assert.equal(bytePlusVideoModelResponse.status, 201)
    const bytePlusVideoResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: bytePlusVideoModel.model.id, prompt: 'Test direct BytePlus video.', options: { aspect: '16:9', quality: '720p', duration: '5 seconds' } }),
    })
    const bytePlusVideo = await bytePlusVideoResponse.json()
    assert.equal(bytePlusVideoResponse.status, 202)
    assert.equal(bytePlusVideo.generation.providerRequestId, 'bp-video-1')
    assert.equal((await fetch(baseUrl + '/v1/admin/reconcile', { method: 'POST', headers })).status, 200)
    const bytePlusVideoStatus = await (await fetch(baseUrl + '/v1/generations/' + bytePlusVideo.generation.id, { headers })).json()
    assert.equal(bytePlusVideoStatus.generation.status, 'complete')
    assert.equal(bytePlusVideoStatus.generation.resultUrl, 'https://media.example/byteplus.mp4')
    const perRunPolicyResponse = await fetch(baseUrl + '/v1/admin/policies', {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceMonthlyLimitUsd: 100, perGenerationLimitUsd: 0.25, warnAtPercent: 85 }),
    })
    const perRunPolicy = await perRunPolicyResponse.json()
    assert.equal(perRunPolicyResponse.status, 200)
    assert.equal(perRunPolicy.policy.perGenerationLimitNanoUsd, 250000000)
    const perRunBlockedResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: createdModel.model.id, prompt: 'This request should exceed the per-run limit.' }),
    })
    assert.equal(perRunBlockedResponse.status, 402)
    assert.equal((await perRunBlockedResponse.json()).error, 'generation_limit_exceeded')
    await fetch(baseUrl + '/v1/admin/policies', {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceMonthlyLimitUsd: 0.6, perGenerationLimitUsd: 0, warnAtPercent: 80 }),
    })
    const workspaceBlockedResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: createdModel.model.id, prompt: 'This request should exceed the monthly workspace limit.' }),
    })
    assert.equal(workspaceBlockedResponse.status, 402)
    assert.equal((await workspaceBlockedResponse.json()).error, 'workspace_budget_exceeded')
    const budgetUsage = await (await fetch(baseUrl + '/v1/usage/summary', { headers })).json()
    assert.equal(budgetUsage.monthlyCommittedNanoUsd, 450000000)
    assert.equal(budgetUsage.budget.workspaceMonthlyLimitNanoUsd, 600000000)
    assert.equal(budgetUsage.providerUsage.spendNanoUsd, 450000000)
    assert.equal(budgetUsage.providerUsage.byEndpoint[0].endpointId, 'test/video')
    assert.equal(budgetUsage.balances.find(item => item.provider === 'fal.ai').amountNanoUsd, 24500000000)
    const disableModelResponse = await fetch(baseUrl + '/v1/admin/models/' + createdModel.model.id, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'disabled' }),
    })
    assert.equal(disableModelResponse.status, 200)
    const editModelResponse = await fetch(baseUrl + '/v1/admin/models/' + createdModel.model.id, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Edited Video Model', description: 'Updated from the admin catalog.', priceUsd: 0.55 }),
    })
    const editedModel = await editModelResponse.json()
    assert.equal(editModelResponse.status, 200)
    assert.equal(editedModel.model.name, 'Edited Video Model')
    assert.equal(editedModel.model.priceNanoUsd, 550000000)
    const deleteModelResponse = await fetch(baseUrl + '/v1/admin/models/' + createdModel.model.id, { method: 'DELETE', headers })
    assert.equal(deleteModelResponse.status, 200)
    const adminModelsAfterArchive = await (await fetch(baseUrl + '/v1/admin/models', { headers })).json()
    assert.equal(adminModelsAfterArchive.models.some(item => item.id === createdModel.model.id), false)

    const usageResponse = await fetch(baseUrl + '/v1/usage/summary', { headers })
    const usage = await usageResponse.json()
    assert.equal(usageResponse.status, 200)
    assert.equal(usage.byModel.length, 8)

    const queueResponse = await fetch(baseUrl + '/v1/generations', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt', prompt: 'Verify that this prompt is written to the authenticated job ledger.' }),
    })
    const queued = await queueResponse.json()
    assert.equal(queueResponse.status, 409)
    assert.equal(queued.error, 'model_not_ready')

    const memberLoginResponse = await fetch(baseUrl + '/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jamie@cresco.local', password: 'test-member-password', client: 'test' }),
    })
    const memberLogin = await memberLoginResponse.json()
    const memberHeaders = { authorization: 'Bearer ' + memberLogin.token }
    const hiddenGenerationResponse = await fetch(baseUrl + '/v1/generations/' + falGeneration.generation.id, { headers: memberHeaders })
    assert.equal(hiddenGenerationResponse.status, 404)
    const hiddenUploadResponse = await fetch(baseUrl + '/v1/uploads/' + uploaded.upload.id, { headers: memberHeaders })
    assert.equal(hiddenUploadResponse.status, 404)
    const profileResponse = await fetch(baseUrl + '/v1/me', {
      method: 'PATCH', headers: { ...memberHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Jamie Updated', preferences: { weeklySummary: false } }),
    })
    const profile = await profileResponse.json()
    assert.equal(profileResponse.status, 200)
    assert.equal(profile.user.name, 'Jamie Updated')
    assert.equal(profile.user.preferences.weeklySummary, false)
    assert.equal(profile.user.sessionVersion, undefined)
    const passwordResponse = await fetch(baseUrl + '/v1/me', {
      method: 'PATCH', headers: { ...memberHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'test-member-password', newPassword: 'updated-member-password' }),
    })
    const passwordUpdate = await passwordResponse.json()
    assert.equal(passwordResponse.status, 200)
    assert.ok(passwordUpdate.token)
    assert.equal((await fetch(baseUrl + '/v1/me', { headers: memberHeaders })).status, 401)
    assert.equal((await fetch(baseUrl + '/v1/me', { headers: { authorization: 'Bearer ' + passwordUpdate.token } })).status, 200)

    const auditResponse = await fetch(baseUrl + '/v1/admin/audit', { headers })
    const audit = await auditResponse.json()
    assert.equal(auditResponse.status, 200)
    assert.ok(audit.events.some(event => event.action === 'model.archived'))

    const anonymousResponse = await fetch(baseUrl + '/v1/admin/users')
    assert.equal(anonymousResponse.status, 401)
  } finally {
    child.kill()
    await new Promise(resolveClose => providerServer.close(resolveClose))
    await rm(directory, { recursive: true, force: true })
  }
})
