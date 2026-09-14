import { createServer } from 'node:http'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv(resolve(apiRoot, '.env'))

const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '127.0.0.1'
const dataPath = resolve(apiRoot, process.env.CRESCO_DATA_PATH || '.data/cresco.json')
const uploadRoot = resolve(apiRoot, process.env.CRESCO_UPLOAD_PATH || '.data/uploads')
const tokenSecret = process.env.CRESCO_TOKEN_SECRET || 'local-development-secret-change-before-deployment'
const encryptionSecret = process.env.CRESCO_ENCRYPTION_KEY || 'local-development-encryption-key-change-before-deployment'
const encryptionKey = createHash('sha256').update(encryptionSecret).digest()
const falQueueBaseUrl = process.env.CRESCO_FAL_QUEUE_URL || 'https://queue.fal.run'
const falPlatformBaseUrl = process.env.CRESCO_FAL_PLATFORM_URL || 'https://api.fal.ai/v1'
const bytePlusBaseUrl = process.env.CRESCO_BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3'
const allowedOrigins = new Set((process.env.CRESCO_ALLOWED_ORIGINS || 'http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()))
const rateWindows = new Map()

if (process.env.NODE_ENV === 'production' && tokenSecret.startsWith('local-development')) {
  throw new Error('CRESCO_TOKEN_SECRET must be configured in production')
}
if (process.env.NODE_ENV === 'production' && encryptionSecret.startsWith('local-development')) {
  throw new Error('CRESCO_ENCRYPTION_KEY must be configured in production')
}
if (process.env.NODE_ENV === 'production' && (!process.env.CRESCO_ADMIN_PASSWORD || !process.env.CRESCO_MEMBER_PASSWORD)) {
  throw new Error('CRESCO_ADMIN_PASSWORD and CRESCO_MEMBER_PASSWORD must be configured in production')
}

let db = await loadDatabase()
let databaseMigrated = false
if (!db.credentials) { db.credentials = []; databaseMigrated = true }
if (!db.uploads) { db.uploads = []; databaseMigrated = true }
if (!db.providerUsage) { db.providerUsage = []; databaseMigrated = true }
if (!db.sessions) { db.sessions = []; databaseMigrated = true }
if (!db.policies) {
  db.policies = { workspaceMonthlyLimitNanoUsd: 0, perGenerationLimitNanoUsd: 0, warnAtPercent: 80 }
  databaseMigrated = true
}
if ((db.generations || []).some(item => item.prompt === 'Seeded local preview record')) {
  db.generations = db.generations.filter(item => item.prompt !== 'Seeded local preview record')
  databaseMigrated = true
}
for (const generation of db.generations || []) {
  const ageMs = Date.now() - Date.parse(generation.createdAt)
  if (generation.status === 'queued' && !generation.providerStatusUrl && ageMs > 5 * 60 * 1000) {
    generation.status = 'failed'
    generation.providerState = generation.providerState || 'not_dispatched'
    generation.error = generation.error || 'legacy_job_not_dispatched'
    generation.completedAt = new Date().toISOString()
    databaseMigrated = true
  }
}
for (const user of db.users || []) {
  if (!user.sessionVersion) { user.sessionVersion = 1; databaseMigrated = true }
  if (!user.preferences) { user.preferences = { generationCompleted: true, weeklySummary: true, generationFailed: true }; databaseMigrated = true }
}
for (const balance of db.balances || []) {
  if (!balance.providerVerifiedAt) {
    if (balance.source === 'provider') { balance.source = 'ledger'; databaseMigrated = true }
    if (balance.amountNanoUsd !== 0) { balance.amountNanoUsd = 0; databaseMigrated = true }
  }
}
const defaultPrices = { gpt: 20000000, claude: 30000000, veo: 620000000, seedance: 3030000000, imagen: 80000000 }
for (const model of db.models) {
  if (model.priceNanoUsd == null && defaultPrices[model.id]) { model.priceNanoUsd = defaultPrices[model.id]; databaseMigrated = true }
  if (model.id === 'seedance' && !model.endpoint) { model.endpoint = 'bytedance/seedance-2.0/text-to-video'; databaseMigrated = true }
}
if (databaseMigrated) await persist()

function loadEnv(path) {
  if (!existsSync(path)) return
  const contents = requireRead(path)
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 1) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

function requireRead(path) {
  try {
    return process.getBuiltinModule('fs').readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const result = await scrypt(password, salt, 64)
  return salt + ':' + Buffer.from(result).toString('hex')
}

async function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':')
  if (!salt || !expectedHex) return false
  const result = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return result.length === expected.length && timingSafeEqual(result, expected)
}

async function loadDatabase() {
  try {
    return JSON.parse(await readFile(dataPath, 'utf8'))
  } catch {
    const now = new Date().toISOString()
    const adminPassword = process.env.CRESCO_ADMIN_PASSWORD || 'admin-preview'
    const memberPassword = process.env.CRESCO_MEMBER_PASSWORD || 'member-preview'
    const initial = {
      version: 1,
      users: [
        { id: randomUUID(), name: 'Workspace Owner', email: (process.env.CRESCO_ADMIN_EMAIL || 'admin@cresco.local').toLowerCase(), role: 'admin', status: 'active', sessionVersion: 1, preferences: { generationCompleted: true, weeklySummary: true, generationFailed: true }, passwordHash: await hashPassword(adminPassword), createdAt: now },
        { id: randomUUID(), name: 'Jamie Doe', email: (process.env.CRESCO_MEMBER_EMAIL || 'jamie@cresco.local').toLowerCase(), role: 'member', status: 'active', sessionVersion: 1, preferences: { generationCompleted: true, weeklySummary: true, generationFailed: true }, passwordHash: await hashPassword(memberPassword), createdAt: now },
      ],
      models: [
        { id: 'gpt', name: 'GPT-5', provider: 'OpenAI', kind: 'text', status: 'active', priceNanoUsd: 20000000, createdAt: now },
        { id: 'claude', name: 'Claude Sonnet', provider: 'Anthropic', kind: 'text', status: 'active', priceNanoUsd: 30000000, createdAt: now },
        { id: 'veo', name: 'Veo 3', provider: 'Google', kind: 'video', status: 'active', priceNanoUsd: 620000000, createdAt: now },
        { id: 'seedance', name: 'Seedance 2.0', provider: 'fal.ai · ByteDance', kind: 'video', status: 'active', priceNanoUsd: 3030000000, createdAt: now },
        { id: 'imagen', name: 'Imagen 4', provider: 'Google', kind: 'image', status: 'beta', priceNanoUsd: 80000000, createdAt: now },
      ],
      generations: [],
      balances: [
        { provider: 'fal.ai', amountNanoUsd: 0, source: 'ledger', syncedAt: now },
        { provider: 'OpenAI', amountNanoUsd: 0, source: 'ledger', syncedAt: now },
        { provider: 'Google', amountNanoUsd: 0, source: 'ledger', syncedAt: now },
      ],
      uploads: [],
      credentials: [],
      providerUsage: [],
      policies: { workspaceMonthlyLimitNanoUsd: 0, perGenerationLimitNanoUsd: 0, warnAtPercent: 80 },
      audit: [],
    }
    await persist(initial)
    return initial
  }
}

async function persist(value = db) {
  await mkdir(dirname(dataPath), { recursive: true })
  const temporary = dataPath + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, dataPath)
}

function safeUser(user) {
  const { passwordHash: _, sessionVersion: __, ...safe } = user
  return safe
}

function encryptSecret(value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(item => item.toString('base64url')).join('.')
}

function decryptSecret(value) {
  const [iv, tag, encrypted] = String(value).split('.').map(part => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !encrypted) throw new Error('invalid_encrypted_secret')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function providerKey(provider) {
  const value = String(provider).trim().toLowerCase()
  if (value.includes('fal.ai') || value === 'fal') return 'fal.ai'
  if (value.includes('byteplus') || value.includes('modelark')) return 'byteplus'
  if (value.includes('openai')) return 'openai'
  if (value.includes('anthropic')) return 'anthropic'
  if (value.includes('google')) return 'google'
  return value
}

function credentialFor(provider) {
  const key = providerKey(provider)
  return db.credentials.find(item => providerKey(item.provider) === key)
}

function storeCredential(provider, apiKey) {
  const normalizedProvider = providerKey(provider)
  const existing = credentialFor(normalizedProvider)
  const value = { provider: normalizedProvider, encryptedApiKey: encryptSecret(String(apiKey)), updatedAt: new Date().toISOString() }
  if (existing) Object.assign(existing, value)
  else db.credentials.push({ id: randomUUID(), createdAt: value.updatedAt, ...value })
}

function safeModel(model) {
  if (model.contextTurns === undefined) model.contextTurns = 8
  const credentialConfigured = Boolean(credentialFor(model.provider))
  const adapterConfigured = ['fal.ai', 'byteplus'].includes(providerKey(model.provider))
  return { ...model, credentialConfigured, adapterConfigured, executionReady: Boolean(credentialConfigured && adapterConfigured && model.endpoint && model.status !== 'disabled') }
}

// A thread is named after whatever started it, the way a chat client does.
function sessionTitleFrom(prompt) {
  const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned
}

function safeSession(session, extra = {}) {
  if (!session) return null
  const { userId: _userId, archivedAt: _archivedAt, ...safe } = session
  return { ...safe, ...extra }
}

function sessionCount(sessionId) {
  return db.generations.filter(item => item.sessionId === sessionId).length
}

function sessionFor(user, model, sessionId, prompt) {
  if (sessionId) {
    const existing = db.sessions.find(item => item.id === sessionId && !item.archivedAt)
    if (!existing || existing.userId !== user.id) return { error: 'session_not_found', status: 404 }
    if (existing.modelId !== model.id) return { error: 'session_model_mismatch', status: 400 }
    return { session: existing }
  }
  const timestamp = new Date().toISOString()
  const created = { id: randomUUID(), userId: user.id, modelId: model.id, title: sessionTitleFrom(prompt), createdAt: timestamp, updatedAt: timestamp, archivedAt: null }
  db.sessions.unshift(created)
  return { session: created }
}

function safeGeneration(generation) {
  const { result: _, providerStatusUrl: __, providerResponseUrl: ___, lastProviderError: ____, ...safe } = generation
  const queuedForMs = generation.status === 'queued' ? Date.now() - Date.parse(generation.createdAt) : null
  return {
    ...safe,
    outputText: providerOutputText(generation.result),
    queuedForMs: Number.isFinite(queuedForMs) ? queuedForMs : null,
    references: (generation.referenceIds || []).map(id => db.uploads.find(item => item.id === id)).filter(Boolean).map(safeUpload),
  }
}

function safeUpload(upload) {
  const { storageKey: _, ...safe } = upload
  return safe
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, role: user.role, sv: user.sessionVersion || 1, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 })).toString('base64url')
  const signature = createHmac('sha256', tokenSecret).update(payload).digest('base64url')
  return payload + '.' + signature
}

function authenticate(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', tokenSecret).update(payload).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (claims.exp < Date.now() / 1000) return null
    return db.users.find(user => user.id === claims.sub && user.status === 'active' && (user.sessionVersion || 1) === claims.sv) || null
  } catch {
    return null
  }
}

function send(response, status, body, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  }
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-credentials'] = 'true'
    headers.vary = 'Origin'
  }
  response.writeHead(status, headers)
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  let data = ''
  for await (const chunk of request) {
    data += chunk
    if (data.length > 1024 * 1024) throw new Error('body_too_large')
  }
  if (!data) return {}
  try {
    return JSON.parse(data)
  } catch {
    throw new Error('invalid_json')
  }
}

async function readBinary(request, limit = 25 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('file_too_large')
    chunks.push(chunk)
  }
  if (!size) throw new Error('empty_file')
  return Buffer.concat(chunks)
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 20000
const DEFAULT_TEXT_TIMEOUT_MS = 120000
const DEFAULT_TEXT_STREAM_TIMEOUT_MS = 300000
const THINKING_MODES = ['disabled', 'enabled', 'auto']
const TEXT_APIS = ['chat_completions', 'responses']

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function providerTimeoutMs(kind, streaming = false) {
  if (kind !== 'text') return positiveInt(process.env.CRESCO_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS)
  if (streaming) return positiveInt(process.env.CRESCO_TEXT_STREAM_TIMEOUT_MS, DEFAULT_TEXT_STREAM_TIMEOUT_MS)
  return positiveInt(process.env.CRESCO_TEXT_TIMEOUT_MS, DEFAULT_TEXT_TIMEOUT_MS)
}

function requestPath(url) {
  try {
    return new URL(url).pathname
  } catch {
    return 'unknown'
  }
}

// Prompts, results and credentials are never logged: only routing and timing.
function logProviderCall(details) {
  console.log(JSON.stringify({ event: 'provider_call', ...details }))
}

function isTimeoutError(error) {
  const name = String(error?.name || '')
  return name === 'TimeoutError' || name === 'AbortError' || /aborted due to timeout/i.test(String(error?.message || ''))
}

// Members should never see a raw DOMException. The original text is kept on the
// generation as lastProviderError so the cause stays diagnosable.
function providerFailure(error, timeoutMs) {
  const detail = error instanceof Error ? error.message : String(error)
  const failure = isTimeoutError(error)
    ? new Error(`provider_timeout_after_${Math.round(timeoutMs / 1000)}s`)
    : new Error(detail || 'provider_request_failed')
  failure.providerDetail = detail
  return failure
}

function providerDetail(error) {
  if (error?.providerDetail) return String(error.providerDetail)
  return error instanceof Error ? error.message : 'provider_request_failed'
}

function thinkingMode(model) {
  return THINKING_MODES.includes(model?.thinkingMode) ? model.thinkingMode : 'disabled'
}

function textApi(model) {
  return TEXT_APIS.includes(model?.textApi) ? model.textApi : 'chat_completions'
}

function textRequestPath(model) {
  return textApi(model) === 'responses' ? '/responses' : '/chat/completions'
}

const MAX_CONTEXT_TURNS = 50
// Every carried turn is re-sent and re-billed on each message, so the history is
// capped by turn count and by total characters.
const MAX_CONTEXT_CHARS = 24000

function contextTurns(model) {
  const value = Number(model?.contextTurns)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(Math.floor(value), MAX_CONTEXT_TURNS)
}

// Oldest first, trimmed from the front once the character budget is spent, so the
// most recent exchanges always survive.
function trimContext(messages) {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0)
  let start = 0
  while (total > MAX_CONTEXT_CHARS && start < messages.length - 1) {
    total -= messages[start].content.length
    start += 1
  }
  return messages.slice(start)
}

// Earlier turns of the same thread, as alternating user/assistant messages. Only
// completed turns that actually produced text are carried.
function threadContext(generation, model) {
  const turns = contextTurns(model)
  if (!turns || model.kind !== 'text' || !generation.sessionId) return []
  const earlier = db.generations
    .filter(item => item.sessionId === generation.sessionId && item.id !== generation.id && item.status === 'complete')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-turns)
  const messages = []
  for (const item of earlier) {
    const answer = providerOutputText(item.result)
    if (!item.prompt || !answer) continue
    messages.push({ role: 'user', content: String(item.prompt) })
    messages.push({ role: 'assistant', content: String(answer) })
  }
  return messages
}

// 'auto' leaves the decision to the provider default; anything else is explicit,
// and 'disabled' is the default because a reasoning pass is the main reason a
// flash-class model takes longer than the request timeout.
function textRequestBody(model, prompt, { stream = false, history = [] } = {}) {
  const mode = thinkingMode(model)
  const thinking = mode === 'auto' ? {} : { thinking: { type: mode } }
  const messages = trimContext([...history, { role: 'user', content: prompt }])
  if (textApi(model) === 'responses') {
    return { model: model.endpoint, input: messages, ...thinking, ...(stream ? { stream: true } : {}) }
  }
  return {
    model: model.endpoint,
    messages,
    ...thinking,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  }
}

function rateLimited(request) {
  const authorization = String(request.headers.authorization || '')
  const key = authorization ? 'session:' + createHash('sha256').update(authorization).digest('hex') : 'ip:' + (request.socket.remoteAddress || 'unknown')
  const limit = authorization ? 600 : 60
  const now = Date.now()
  if (rateWindows.size > 10000) {
    for (const [entryKey, entry] of rateWindows) if (entry.resetAt < now) rateWindows.delete(entryKey)
  }
  const current = rateWindows.get(key)
  if (!current || current.resetAt < now) {
    rateWindows.set(key, { count: 1, resetAt: now + 60000 })
    return false
  }
  current.count += 1
  return current.count > limit
}

async function audit(user, action, target, metadata = {}) {
  db.audit.unshift({ id: randomUUID(), actorId: user?.id || null, actorEmail: user?.email || 'anonymous', action, target, metadata, createdAt: new Date().toISOString() })
  db.audit = db.audit.slice(0, 10000)
  await persist()
}

function usageSummary() {
  const totals = new Map(db.models.map(model => [model.id, { calls: 0, spendNanoUsd: 0 }]))
  for (const generation of db.generations) {
    const total = totals.get(generation.modelId)
    if (!total) continue
    total.calls += 1
    total.spendNanoUsd += Number(generation.costNanoUsd || 0)
  }
  const byModel = db.models.map(model => {
    const total = totals.get(model.id)
    return {
      modelId: model.id,
      name: model.name,
      provider: model.provider,
      calls: total?.calls || 0,
      spendNanoUsd: total?.spendNanoUsd || 0,
    }
  })
  const memberMap = new Map()
  for (const generation of db.generations) {
    const current = memberMap.get(generation.userEmail) || { email: generation.userEmail, calls: 0, spendNanoUsd: 0 }
    current.calls += 1
    current.spendNanoUsd += Number(generation.costNanoUsd || 0)
    memberMap.set(generation.userEmail, current)
  }
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthlySpendNanoUsd = db.generations.filter(item => Date.parse(item.createdAt) >= monthStart.getTime()).reduce((sum, item) => sum + Number(item.costNanoUsd || 0), 0)
  const monthlyCommittedNanoUsd = db.generations.filter(item => Date.parse(item.createdAt) >= monthStart.getTime()).reduce((sum, item) => {
    if (item.status !== 'queued') return sum + Number(item.costNanoUsd || 0)
    const model = db.models.find(entry => entry.id === item.modelId)
    return sum + Number(model?.priceNanoUsd || 0)
  }, 0)
  const latestProviderPeriod = db.providerUsage.map(item => item.periodStart).sort().at(-1)
  const providerUsage = latestProviderPeriod ? db.providerUsage.filter(item => item.periodStart === latestProviderPeriod) : []
  return {
    spendNanoUsd: byModel.reduce((sum, item) => sum + item.spendNanoUsd, 0),
    calls: byModel.reduce((sum, item) => sum + item.calls, 0),
    byModel,
    byMember: [...memberMap.values()].sort((a, b) => b.spendNanoUsd - a.spendNanoUsd),
    monthlySpendNanoUsd,
    monthlyCommittedNanoUsd,
    budget: { ...db.policies },
    balances: db.balances,
    providerUsage: providerUsage.length ? {
      periodStart: latestProviderPeriod,
      spendNanoUsd: providerUsage.reduce((sum, item) => sum + Number(item.spendNanoUsd || 0), 0),
      syncedAt: providerUsage.map(item => item.syncedAt).sort().at(-1),
      byEndpoint: providerUsage,
    } : null,
  }
}

function pageRows(rows, url, fallbackLimit = 100) {
  const requested = Number(url.searchParams.get('limit') || fallbackLimit)
  const limit = Math.min(250, Math.max(1, Number.isFinite(requested) ? requested : fallbackLimit))
  const cursor = url.searchParams.get('cursor')
  const start = cursor ? Math.max(0, rows.findIndex(item => item.id === cursor) + 1) : 0
  const page = rows.slice(start, start + limit)
  return { page, nextCursor: start + limit < rows.length ? page.at(-1)?.id || null : null }
}

function toNanoUsd(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return null
  return Math.round(amount * 1_000_000_000)
}

function falInput(generation, user) {
  const input = { prompt: generation.prompt, end_user_id: user.id }
  const aspect = generation.options?.aspect
  const quality = generation.options?.quality
  const duration = generation.options?.duration
  if (aspect && aspect !== 'Auto') input.aspect_ratio = aspect
  if (quality && /^\d+p$/.test(quality)) input.resolution = quality
  if (duration) input.duration = String(duration).replace(/\s*seconds?$/i, '')
  const publicReference = (generation.referenceIds || []).map(id => db.uploads.find(item => item.id === id)).find(item => item?.publicUrl)
  if (publicReference?.contentType?.startsWith('image/')) input.image_url = publicReference.publicUrl
  if (publicReference?.contentType?.startsWith('video/')) input.video_url = publicReference.publicUrl
  if (publicReference?.contentType?.startsWith('audio/')) input.audio_url = publicReference.publicUrl
  return input
}

async function falRequest(url, credential, init = {}) {
  const { timeoutMs = providerTimeoutMs(null), kind = null, ...rest } = init
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { authorization: 'Key ' + decryptSecret(credential.encryptedApiKey), 'content-type': 'application/json', ...rest.headers },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    logProviderCall({ provider: 'fal.ai', kind, path: requestPath(url), ok: false, durationMs: Date.now() - startedAt, timeoutMs, error: String(error?.name || 'FetchError') })
    throw providerFailure(error, timeoutMs)
  }
  const data = await response.json().catch(() => ({}))
  logProviderCall({ provider: 'fal.ai', kind, path: requestPath(url), ok: response.ok, status: response.status, durationMs: Date.now() - startedAt })
  if (!response.ok) throw new Error(data.detail || data.message || `fal_request_failed_${response.status}`)
  return data
}

async function bytePlusRequest(url, credential, init = {}) {
  const { timeoutMs = providerTimeoutMs(null), kind = null, ...rest } = init
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { authorization: 'Bearer ' + decryptSecret(credential.encryptedApiKey), 'content-type': 'application/json', ...rest.headers },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    logProviderCall({ provider: 'byteplus', kind, path: requestPath(url), ok: false, durationMs: Date.now() - startedAt, timeoutMs, error: String(error?.name || 'FetchError') })
    throw providerFailure(error, timeoutMs)
  }
  const data = await response.json().catch(() => ({}))
  logProviderCall({ provider: 'byteplus', kind, path: requestPath(url), ok: response.ok, status: response.status, durationMs: Date.now() - startedAt })
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `byteplus_request_failed_${response.status}`)
  return data
}

function bytePlusReferences(generation) {
  return (generation.referenceIds || []).map(id => db.uploads.find(item => item.id === id)).filter(item => item?.publicUrl).map(upload => {
    if (upload.contentType.startsWith('image/')) return { type: 'image_url', image_url: { url: upload.publicUrl }, role: 'reference_image' }
    if (upload.contentType.startsWith('video/')) return { type: 'video_url', video_url: { url: upload.publicUrl }, role: 'reference_video' }
    return { type: 'audio_url', audio_url: { url: upload.publicUrl }, role: 'reference_audio' }
  })
}

async function dispatchBytePlusGeneration(generation, model, credential) {
  const base = bytePlusBaseUrl.replace(/\/$/, '')
  const timeoutMs = providerTimeoutMs(model.kind)
  if (model.kind === 'text') {
    const result = await bytePlusRequest(base + textRequestPath(model), credential, {
      method: 'POST', kind: model.kind, timeoutMs,
      body: JSON.stringify(textRequestBody(model, generation.prompt, { history: threadContext(generation, model) })),
    })
    return { asynchronous: false, result, requestId: result.id || null }
  }
  const references = bytePlusReferences(generation)
  if (model.kind === 'image') {
    const images = references.filter(item => item.type === 'image_url').map(item => item.image_url.url)
    const result = await bytePlusRequest(base + '/images/generations', credential, { method: 'POST', kind: model.kind, timeoutMs, body: JSON.stringify({
      model: model.endpoint, prompt: generation.prompt, response_format: 'url', watermark: false,
      ...(generation.options?.quality === 'High' ? { size: '2K' } : {}),
      ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
    }) })
    return { asynchronous: false, result, requestId: result.id || null }
  }
  const result = await bytePlusRequest(base + '/contents/generations/tasks', credential, { method: 'POST', kind: model.kind, timeoutMs, body: JSON.stringify({
    model: model.endpoint, content: [{ type: 'text', text: generation.prompt }, ...references], watermark: false,
    ...(generation.options?.aspect ? { ratio: generation.options.aspect } : {}),
    ...(generation.options?.quality ? { resolution: generation.options.quality } : {}),
    ...(generation.options?.duration ? { duration: Number(String(generation.options.duration).replace(/\D/g, '')) || undefined } : {}),
  }) })
  if (!result.id) throw new Error('byteplus_task_id_missing')
  const statusUrl = base + '/contents/generations/tasks/' + encodeURIComponent(result.id)
  return { asynchronous: true, result, requestId: result.id, statusUrl }
}

async function falPages(path, field, credential, searchParams) {
  const rows = []
  let cursor = null
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(falPlatformBaseUrl.replace(/\/$/, '') + '/' + path)
    for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, String(value))
    if (cursor) url.searchParams.set('cursor', cursor)
    const data = await falRequest(url.toString(), credential)
    rows.push(...(Array.isArray(data[field]) ? data[field] : []))
    cursor = data.has_more && data.next_cursor ? String(data.next_cursor) : null
    if (!cursor) break
  }
  return rows
}

function billingEventCost(event) {
  const direct = Number(event?.cost_estimate_nano_usd)
  if (Number.isFinite(direct) && direct >= 0) return Math.round(direct)
  return toNanoUsd(event?.cost_total ?? event?.cost)
}

async function reconcileFalGenerationCosts(credential) {
  const generations = db.generations.filter(item => item.status === 'complete' && item.providerRequestId && item.costSource !== 'provider' && providerKey(item.modelProvider).includes('fal')).slice(0, 250)
  let updated = 0
  for (let offset = 0; offset < generations.length; offset += 50) {
    const batch = generations.slice(offset, offset + 50)
    const events = await falPages('models/billing-events', 'billing_events', credential, {
      request_id: batch.map(item => item.providerRequestId).join(','),
      limit: 10000,
    })
    const byRequest = new Map(events.map(event => [String(event.request_id), event]))
    for (const generation of batch) {
      const cost = billingEventCost(byRequest.get(String(generation.providerRequestId)))
      if (cost === null) continue
      generation.costNanoUsd = cost
      generation.costSource = 'provider'
      updated += 1
    }
  }
  return updated
}

async function syncFalUsage(credential, syncedAt) {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date()
  end.setUTCDate(end.getUTCDate() + 1)
  end.setUTCHours(0, 0, 0, 0)
  const buckets = await falPages('models/usage', 'time_series', credential, {
    start: start.toISOString(), end: end.toISOString(), timezone: 'UTC', timeframe: 'day', bound_to_timeframe: 'false', expand: 'time_series', limit: 1000,
  })
  const byEndpoint = new Map()
  for (const bucket of buckets) {
    for (const item of Array.isArray(bucket.results) ? bucket.results : []) {
      const endpointId = String(item.endpoint_id || 'unknown')
      const current = byEndpoint.get(endpointId) || { provider: 'fal.ai', endpointId, quantity: 0, spendNanoUsd: 0, currency: String(item.currency || 'USD') }
      current.quantity += Number(item.quantity || 0)
      current.spendNanoUsd += billingEventCost(item) || 0
      byEndpoint.set(endpointId, current)
    }
  }
  db.providerUsage = db.providerUsage.filter(item => !(item.provider === 'fal.ai' && item.periodStart === start.toISOString()))
  for (const item of byEndpoint.values()) db.providerUsage.push({ ...item, periodStart: start.toISOString(), syncedAt })
  return { periodStart: start.toISOString(), endpoints: byEndpoint.size, spendNanoUsd: [...byEndpoint.values()].reduce((sum, item) => sum + item.spendNanoUsd, 0) }
}

async function syncFalAccount() {
  const credential = credentialFor('fal.ai')
  if (!credential) return { provider: 'fal.ai', configured: false, synced: false }
  const syncedAt = new Date().toISOString()
  const billing = await falRequest(falPlatformBaseUrl.replace(/\/$/, '') + '/account/billing?expand=credits', credential)
  const balanceNanoUsd = toNanoUsd(billing?.credits?.current_balance)
  if (balanceNanoUsd === null) throw new Error('fal_balance_missing')
  if (String(billing?.credits?.currency || 'USD').toUpperCase() !== 'USD') throw new Error('fal_balance_currency_unsupported')
  const balance = db.balances.find(item => providerKey(item.provider) === 'fal.ai')
  const nextBalance = { provider: 'fal.ai', amountNanoUsd: balanceNanoUsd, source: 'provider', syncedAt }
  if (balance) Object.assign(balance, nextBalance)
  else db.balances.push(nextBalance)
  const [reconciledCosts, usage] = await Promise.all([reconcileFalGenerationCosts(credential), syncFalUsage(credential, syncedAt)])
  await persist()
  return { provider: 'fal.ai', configured: true, synced: true, balanceNanoUsd, reconciledCosts, usage, syncedAt }
}

async function dispatchGeneration(generation, model, user) {
  const credential = credentialFor(model.provider)
  const provider = providerKey(model.provider)
  if (!credential || !model.endpoint || !['fal.ai', 'byteplus'].includes(provider)) {
    generation.providerState = credential ? 'adapter_required' : 'credential_required'
    generation.status = 'failed'
    generation.error = credential ? 'provider_adapter_required' : 'provider_credential_required'
    generation.completedAt = new Date().toISOString()
    await persist()
    return
  }
  const startedAt = Date.now()
  try {
    if (provider === 'fal.ai') {
      const data = await falRequest(falQueueBaseUrl.replace(/\/$/, '') + '/' + model.endpoint.replace(/^\/+/, ''), credential, {
        method: 'POST', kind: model.kind, body: JSON.stringify(falInput(generation, user)),
      })
      generation.providerRequestId = data.request_id
      generation.providerStatusUrl = data.status_url
      generation.providerResponseUrl = data.response_url
      generation.providerState = 'submitted'
      generation.dispatchedAt = new Date().toISOString()
    } else {
      const dispatched = await dispatchBytePlusGeneration(generation, model, credential)
      generation.providerRequestId = dispatched.requestId
      generation.providerState = dispatched.asynchronous ? 'submitted' : 'succeeded'
      generation.dispatchedAt = new Date().toISOString()
      if (dispatched.asynchronous) {
        generation.providerStatusUrl = dispatched.statusUrl
        generation.providerResponseUrl = dispatched.statusUrl
      } else {
        generation.status = 'complete'
        generation.result = dispatched.result
        generation.resultUrl = resultUrl(dispatched.result)
        generation.costNanoUsd = Number(model.priceNanoUsd || 0)
        generation.costSource = model.priceNanoUsd ? 'catalog_estimate' : 'pending_reconciliation'
        generation.completedAt = new Date().toISOString()
      }
    }
  } catch (error) {
    generation.status = 'failed'
    generation.providerState = 'submission_failed'
    generation.error = error instanceof Error ? error.message : 'provider_submission_failed'
    generation.lastProviderError = providerDetail(error)
    generation.completedAt = new Date().toISOString()
  }
  generation.providerLatencyMs = Date.now() - startedAt
  await persist()
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Chat-completions chunks carry choices[].delta.content; the responses API emits
// typed output_text deltas. Both normalise to a plain string here.
function streamTextDelta(payload) {
  const delta = payload?.choices?.[0]?.delta
  if (typeof delta?.content === 'string') return delta.content
  if (Array.isArray(delta?.content)) return delta.content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
  if (payload?.type === 'response.output_text.delta' && typeof payload.delta === 'string') return payload.delta
  return ''
}

async function* bytePlusTextStream(prompt, model, credential, history = []) {
  const url = bytePlusBaseUrl.replace(/\/$/, '') + textRequestPath(model)
  const timeoutMs = providerTimeoutMs('text', true)
  const startedAt = Date.now()
  let upstream
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + decryptSecret(credential.encryptedApiKey),
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(textRequestBody(model, prompt, { stream: true, history })),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: false, durationMs: Date.now() - startedAt, timeoutMs, error: String(error?.name || 'FetchError') })
    throw providerFailure(error, timeoutMs)
  }
  if (!upstream.ok || !upstream.body) {
    const data = await upstream.json().catch(() => ({}))
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: false, status: upstream.status, durationMs: Date.now() - startedAt })
    throw new Error(data?.error?.message || data?.message || `byteplus_request_failed_${upstream.status}`)
  }
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstDeltaMs = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        let payload
        try {
          payload = JSON.parse(raw)
        } catch {
          continue
        }
        const text = streamTextDelta(payload)
        if (text && firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt
        yield { delta: text, requestId: payload?.id || null, usage: payload?.usage || null }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: true, status: upstream.status, firstDeltaMs, durationMs: Date.now() - startedAt })
  }
}

// Streaming keeps the member-visible wait at time-to-first-token instead of the
// full completion. The record is finalised before the stream closes so a reload
// shows the same result the stream delivered.
async function streamTextGeneration(response, origin, generation, model, credential, session) {
  const headers = {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  }
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-credentials'] = 'true'
    headers.vary = 'Origin'
  }
  response.writeHead(200, headers)
  const startedAt = Date.now()
  let text = ''
  let usage = null
  let requestId = null
  try {
    response.write(sseFrame('meta', { generation: safeGeneration(generation), session: safeSession(session) }))
    generation.providerState = 'streaming'
    generation.dispatchedAt = new Date().toISOString()
    for await (const chunk of bytePlusTextStream(generation.prompt, model, credential, threadContext(generation, model))) {
      if (chunk.requestId) requestId = chunk.requestId
      if (chunk.usage) usage = chunk.usage
      if (!chunk.delta) continue
      text += chunk.delta
      response.write(sseFrame('delta', { text: chunk.delta }))
    }
    if (!text) throw new Error('provider_empty_response')
    generation.status = 'complete'
    generation.providerRequestId = requestId
    generation.providerState = 'succeeded'
    generation.result = { id: requestId, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text } }], ...(usage ? { usage } : {}) }
    generation.costNanoUsd = Number(model.priceNanoUsd || 0)
    generation.costSource = model.priceNanoUsd ? 'catalog_estimate' : 'pending_reconciliation'
    generation.completedAt = new Date().toISOString()
    generation.providerLatencyMs = Date.now() - startedAt
    await persist()
    response.write(sseFrame('done', { generation: safeGeneration(generation) }))
  } catch (error) {
    generation.status = 'failed'
    generation.providerState = 'stream_failed'
    generation.error = error instanceof Error ? error.message.slice(0, 500) : 'provider_stream_failed'
    generation.lastProviderError = providerDetail(error)
    generation.completedAt = new Date().toISOString()
    generation.providerLatencyMs = Date.now() - startedAt
    await persist()
    response.write(sseFrame('error', { error: generation.error }))
  } finally {
    response.end()
  }
}

function resultUrl(data) {
  return data?.video?.url || data?.image?.url || data?.images?.[0]?.url || data?.data?.[0]?.url || data?.content?.video_url || data?.content?.image_url || data?.audio?.url || data?.url || null
}

function providerOutputText(data) {
  if (!data) return null
  if (typeof data.output_text === 'string') return data.output_text
  if (typeof data.output === 'string') return data.output
  if (typeof data.text === 'string') return data.text
  const message = data?.choices?.[0]?.message
  if (typeof message?.content === 'string' && message.content) return message.content
  if (Array.isArray(message?.content)) {
    const joined = message.content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
    if (joined) return joined
  }
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') return content.text
    }
  }
  return null
}

const DEFAULT_MAX_QUEUED_MINUTES = { text: 10, image: 20, video: 60 }
// A job nothing can advance is failed with a reason rather than left showing
// "Processing" forever.
function maxQueuedMs(kind) {
  const override = positiveInt(process.env.CRESCO_MAX_QUEUED_MINUTES, 0)
  return (override || DEFAULT_MAX_QUEUED_MINUTES[kind] || 30) * 60000
}

async function expireStaleGenerations() {
  let changed = false
  for (const generation of db.generations.filter(item => item.status === 'queued')) {
    const age = Date.now() - Date.parse(generation.createdAt)
    const ceiling = maxQueuedMs(generation.kind)
    if (!Number.isFinite(age) || age <= ceiling) continue
    generation.status = 'failed'
    generation.providerState = 'expired'
    generation.error = `generation_expired_after_${Math.round(ceiling / 60000)}m`
    generation.completedAt = new Date().toISOString()
    changed = true
  }
  if (changed) await persist()
}

async function reconcilePendingGenerations() {
  await expireStaleGenerations()
  const pending = db.generations.filter(item => item.status === 'queued' && item.providerStatusUrl && item.providerResponseUrl).slice(0, 20)
  for (const generation of pending) {
    const model = db.models.find(item => item.id === generation.modelId)
    const credential = model && credentialFor(model.provider)
    if (!model || !credential) {
      generation.status = 'failed'
      generation.providerState = 'unrecoverable'
      generation.error = model ? 'provider_credential_removed' : 'model_removed'
      generation.completedAt = new Date().toISOString()
      await persist()
      continue
    }
    try {
      if (providerKey(model.provider) === 'byteplus') {
        const result = await bytePlusRequest(generation.providerStatusUrl, credential)
        generation.providerState = String(result.status || 'unknown').toLowerCase()
        if (generation.providerState === 'succeeded') {
          generation.status = 'complete'
          generation.result = result
          generation.resultUrl = resultUrl(result)
          generation.costNanoUsd = Number(model.priceNanoUsd || 0)
          generation.costSource = model.priceNanoUsd ? 'catalog_estimate' : 'pending_reconciliation'
          generation.completedAt = new Date().toISOString()
        } else if (['failed', 'cancelled', 'expired'].includes(generation.providerState)) {
          generation.status = 'failed'
          generation.error = String(result?.error?.message || result?.error || `provider_${generation.providerState}`)
          generation.completedAt = new Date().toISOString()
        }
        await persist()
        continue
      }
      const status = await falRequest(generation.providerStatusUrl, credential)
      generation.providerState = String(status.status || 'unknown').toLowerCase()
      if (status.status === 'COMPLETED') {
        const result = await falRequest(generation.providerResponseUrl, credential)
        generation.status = 'complete'
        generation.result = result
        generation.resultUrl = resultUrl(result)
        generation.costNanoUsd = Number(model.priceNanoUsd || 0)
        generation.costSource = model.priceNanoUsd ? 'catalog_estimate' : 'pending_reconciliation'
        generation.completedAt = new Date().toISOString()
      } else if (['FAILED', 'CANCELLED'].includes(String(status.status || '').toUpperCase())) {
        generation.status = 'failed'
        generation.error = String(status.error || status.detail || `provider_${String(status.status).toLowerCase()}`)
        generation.completedAt = new Date().toISOString()
      }
      await persist()
    } catch (error) {
      generation.lastProviderError = error instanceof Error ? error.message : 'provider_poll_failed'
      generation.lastProviderAttemptAt = new Date().toISOString()
      await persist()
    }
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': origin && allowedOrigins.has(origin) ? origin : '',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-max-age': '600',
    })
    return response.end()
  }
  if (rateLimited(request)) return send(response, 429, { error: 'rate_limit_exceeded' }, origin)

  const url = new URL(request.url || '/', 'http://localhost')
  const path = url.pathname
  try {
    if (request.method === 'GET' && path === '/health') {
      return send(response, 200, { status: 'ok', service: 'cresco-api', version: 1 }, origin)
    }
    if (request.method === 'POST' && path === '/v1/auth/login') {
      const body = await readBody(request)
      const email = String(body.email || '').trim().toLowerCase()
      const user = db.users.find(item => item.email === email)
      if (!user || user.status !== 'active' || !(await verifyPassword(String(body.password || ''), user.passwordHash))) {
        await audit(null, 'auth.login_failed', email)
        return send(response, 401, { error: 'invalid_credentials' }, origin)
      }
      await audit(user, 'auth.login', user.id, { client: String(body.client || 'unknown') })
      return send(response, 200, { token: signToken(user), user: safeUser(user) }, origin)
    }

    const user = authenticate(request)
    if (!user) return send(response, 401, { error: 'authentication_required' }, origin)

    if (request.method === 'GET' && path === '/v1/me') return send(response, 200, { user: safeUser(user) }, origin)
    if (request.method === 'PATCH' && path === '/v1/me') {
      const body = await readBody(request)
      const changed = []
      if (body.name !== undefined) {
        const name = String(body.name).trim()
        if (name.length < 2 || name.length > 100) return send(response, 400, { error: 'invalid_name' }, origin)
        user.name = name
        changed.push('name')
      }
      if (body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences)) {
        const next = { ...(user.preferences || {}) }
        for (const key of ['generationCompleted', 'weeklySummary', 'generationFailed']) {
          if (typeof body.preferences[key] === 'boolean') next[key] = body.preferences[key]
        }
        user.preferences = next
        changed.push('preferences')
      }
      if (body.newPassword !== undefined) {
        if (!(await verifyPassword(String(body.currentPassword || ''), user.passwordHash))) return send(response, 400, { error: 'current_password_incorrect' }, origin)
        if (String(body.newPassword).length < 10) return send(response, 400, { error: 'password_too_short' }, origin)
        user.passwordHash = await hashPassword(String(body.newPassword))
        user.sessionVersion = (user.sessionVersion || 1) + 1
        changed.push('password')
      }
      if (!changed.length) return send(response, 400, { error: 'no_profile_changes' }, origin)
      await audit(user, 'profile.updated', user.id, { fields: changed })
      return send(response, 200, { user: safeUser(user), token: signToken(user) }, origin)
    }
    if (request.method === 'GET' && path === '/v1/models') return send(response, 200, { models: db.models.filter(model => model.status !== 'disabled' && !model.archivedAt).map(safeModel) }, origin)
    if (request.method === 'POST' && path === '/v1/uploads') {
      const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      const allowedType = ['image/', 'video/', 'audio/'].some(prefix => contentType.startsWith(prefix))
      if (!allowedType) return send(response, 415, { error: 'unsupported_reference_type' }, origin)
      const fileName = String(url.searchParams.get('name') || 'reference').trim().slice(0, 200)
      const contents = await readBinary(request)
      const id = randomUUID()
      const storageKey = id + '.bin'
      await mkdir(uploadRoot, { recursive: true })
      await writeFile(resolve(uploadRoot, storageKey), contents)
      const upload = { id, ownerEmail: user.email, fileName, contentType, size: contents.length, storageKey, createdAt: new Date().toISOString() }
      db.uploads.unshift(upload)
      await audit(user, 'upload.created', id, { fileName, contentType, size: contents.length })
      return send(response, 201, { upload: safeUpload(upload) }, origin)
    }
    const uploadMatch = path.match(/^\/v1\/uploads\/([^/]+)$/)
    if (uploadMatch && request.method === 'GET') {
      const upload = db.uploads.find(item => item.id === uploadMatch[1])
      if (!upload || (user.role !== 'admin' && upload.ownerEmail !== user.email)) return send(response, 404, { error: 'upload_not_found' }, origin)
      return send(response, 200, { upload: safeUpload(upload) }, origin)
    }
    if (request.method === 'GET' && path === '/v1/history') {
      const rows = user.role === 'admin' ? db.generations : db.generations.filter(item => item.userEmail === user.email)
      const { page, nextCursor } = pageRows(rows, url)
      return send(response, 200, { generations: page.map(safeGeneration), nextCursor }, origin)
    }
    if (request.method === 'GET' && path === '/v1/usage/summary') return send(response, 200, usageSummary(), origin)
    const generationMatch = path.match(/^\/v1\/generations\/([^/]+)$/)
    if (generationMatch && request.method === 'GET') {
      const generation = db.generations.find(item => item.id === generationMatch[1])
      if (!generation) return send(response, 404, { error: 'generation_not_found' }, origin)
      if (user.role !== 'admin' && generation.userEmail !== user.email) return send(response, 404, { error: 'generation_not_found' }, origin)
      return send(response, 200, { generation: safeGeneration(generation) }, origin)
    }
    if (path === '/v1/sessions' && request.method === 'GET') {
      const modelId = url.searchParams.get('modelId')
      const sessions = db.sessions
        .filter(item => item.userId === user.id && !item.archivedAt && (!modelId || item.modelId === modelId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 50)
        .map(item => safeSession(item, { generationCount: sessionCount(item.id) }))
      return send(response, 200, { sessions }, origin)
    }

    if (path === '/v1/sessions' && request.method === 'POST') {
      const body = await readBody(request)
      const model = db.models.find(item => item.id === body.modelId && item.status !== 'disabled' && !item.archivedAt)
      if (!model) return send(response, 400, { error: 'model_required' }, origin)
      const result = sessionFor(user, model, null, body.title)
      await persist()
      return send(response, 201, { session: safeSession(result.session, { generationCount: 0 }) }, origin)
    }

    const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/)
    if (sessionMatch) {
      const session = db.sessions.find(item => item.id === decodeURIComponent(sessionMatch[1]))
      if (!session || session.userId !== user.id || session.archivedAt) return send(response, 404, { error: 'session_not_found' }, origin)
      if (request.method === 'GET') {
        const generations = db.generations
          .filter(item => item.sessionId === session.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(safeGeneration)
        return send(response, 200, { session: safeSession(session, { generationCount: generations.length }), generations }, origin)
      }
      if (request.method === 'PATCH') {
        const body = await readBody(request)
        const title = String(body.title || '').trim().slice(0, 120)
        if (!title) return send(response, 400, { error: 'title_required' }, origin)
        session.title = title
        session.updatedAt = new Date().toISOString()
        await persist()
        return send(response, 200, { session: safeSession(session) }, origin)
      }
      if (request.method === 'DELETE') {
        session.archivedAt = new Date().toISOString()
        await persist()
        return send(response, 200, { archived: true }, origin)
      }
    }

    if (request.method === 'POST' && path === '/v1/generations') {
      const body = await readBody(request)
      const model = db.models.find(item => item.id === body.modelId && item.status !== 'disabled')
      const prompt = String(body.prompt || '').trim()
      if (!model || !prompt) return send(response, 400, { error: 'model_and_prompt_required' }, origin)
      if (!safeModel(model).executionReady) return send(response, 409, { error: 'model_not_ready' }, origin)
      const estimatedCost = Number(model.priceNanoUsd || 0)
      const usage = usageSummary()
      if (db.policies.perGenerationLimitNanoUsd > 0 && estimatedCost > db.policies.perGenerationLimitNanoUsd) {
        return send(response, 402, { error: 'generation_limit_exceeded', estimatedCostNanoUsd: estimatedCost, limitNanoUsd: db.policies.perGenerationLimitNanoUsd }, origin)
      }
      if (db.policies.workspaceMonthlyLimitNanoUsd > 0 && usage.monthlyCommittedNanoUsd + estimatedCost > db.policies.workspaceMonthlyLimitNanoUsd) {
        return send(response, 402, { error: 'workspace_budget_exceeded', estimatedCostNanoUsd: estimatedCost, committedNanoUsd: usage.monthlyCommittedNanoUsd, limitNanoUsd: db.policies.workspaceMonthlyLimitNanoUsd }, origin)
      }
      const referenceIds = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.map(String))].slice(0, 5) : []
      const invalidReference = referenceIds.some(id => {
        const upload = db.uploads.find(item => item.id === id)
        return !upload || (user.role !== 'admin' && upload.ownerEmail !== user.email)
      })
      if (invalidReference) return send(response, 400, { error: 'invalid_reference' }, origin)
      const attached = sessionFor(user, model, body.sessionId, prompt)
      if (attached.error) return send(response, attached.status, { error: attached.error }, origin)
      attached.session.updatedAt = new Date().toISOString()
      const created = {
        id: randomUUID(), userEmail: user.email, sessionId: attached.session.id, title: String(body.title || prompt.slice(0, 64) || 'Untitled generation').trim(),
        modelId: model.id, modelName: model.name, modelProvider: model.provider, kind: model.kind, prompt, status: 'queued', costNanoUsd: 0,
        options: body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options : {},
        referenceIds,
        createdAt: new Date().toISOString(),
      }
      db.generations.unshift(created)
      await audit(user, 'generation.submitted', created.id, { modelId: model.id })
      if (body.stream === true && model.kind === 'text' && providerKey(model.provider) === 'byteplus') {
        return streamTextGeneration(response, origin, created, model, credentialFor(model.provider), attached.session)
      }
      await dispatchGeneration(created, model, user)
      return send(response, created.status === 'complete' ? 201 : 202, { generation: safeGeneration(created) }, origin)
    }

    if (user.role !== 'admin') return send(response, 403, { error: 'admin_required' }, origin)

    if (request.method === 'GET' && path === '/v1/admin/users') return send(response, 200, { users: db.users.map(safeUser) }, origin)
    if (request.method === 'POST' && path === '/v1/admin/users') {
      const body = await readBody(request)
      const email = String(body.email || '').trim().toLowerCase()
      if (!email || !String(body.name || '').trim() || !String(body.password || '').trim()) return send(response, 400, { error: 'name_email_password_required' }, origin)
      if (db.users.some(item => item.email === email)) return send(response, 409, { error: 'email_exists' }, origin)
      if (String(body.password).length < 10) return send(response, 400, { error: 'password_too_short' }, origin)
      const created = { id: randomUUID(), name: String(body.name).trim(), email, role: body.role === 'admin' ? 'admin' : 'member', status: body.status === 'pending' ? 'pending' : 'active', sessionVersion: 1, preferences: { generationCompleted: true, weeklySummary: true, generationFailed: true }, passwordHash: await hashPassword(String(body.password)), createdAt: new Date().toISOString() }
      db.users.push(created)
      await audit(user, 'user.created', created.id, { role: created.role, status: created.status })
      return send(response, 201, { user: safeUser(created) }, origin)
    }

    const userMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/)
    if (userMatch && request.method === 'PATCH') {
      const target = db.users.find(item => item.id === userMatch[1])
      if (!target) return send(response, 404, { error: 'user_not_found' }, origin)
      const body = await readBody(request)
      if (target.id === user.id && ((body.status && body.status !== 'active') || body.role === 'member')) return send(response, 400, { error: 'cannot_remove_own_admin_access' }, origin)
      if (target.role === 'admin' && body.status && body.status !== 'active' && db.users.filter(item => item.role === 'admin' && item.status === 'active').length <= 1) return send(response, 400, { error: 'last_active_admin_required' }, origin)
      if (['active', 'pending', 'suspended'].includes(body.status)) target.status = body.status
      if (['member', 'admin'].includes(body.role)) target.role = body.role
      if (body.password !== undefined) {
        if (String(body.password).length < 10) return send(response, 400, { error: 'password_too_short' }, origin)
        target.passwordHash = await hashPassword(String(body.password))
        target.sessionVersion = (target.sessionVersion || 1) + 1
      }
      await audit(user, 'user.updated', target.id, { status: target.status, role: target.role, passwordReset: body.password !== undefined })
      return send(response, 200, { user: safeUser(target) }, origin)
    }

    if (request.method === 'GET' && path === '/v1/admin/models') return send(response, 200, { models: db.models.filter(model => !model.archivedAt).map(safeModel) }, origin)
    if (request.method === 'PATCH' && path === '/v1/admin/policies') {
      const body = await readBody(request)
      const workspaceMonthlyLimitNanoUsd = toNanoUsd(body.workspaceMonthlyLimitUsd)
      const perGenerationLimitNanoUsd = toNanoUsd(body.perGenerationLimitUsd)
      const warnAtPercent = Number(body.warnAtPercent)
      if (workspaceMonthlyLimitNanoUsd === null || perGenerationLimitNanoUsd === null || !Number.isFinite(warnAtPercent) || warnAtPercent < 1 || warnAtPercent > 100) {
        return send(response, 400, { error: 'invalid_budget_policy' }, origin)
      }
      db.policies = { workspaceMonthlyLimitNanoUsd, perGenerationLimitNanoUsd, warnAtPercent: Math.round(warnAtPercent) }
      await audit(user, 'budget.updated', 'workspace', db.policies)
      return send(response, 200, { policy: db.policies }, origin)
    }
    if (request.method === 'POST' && path === '/v1/admin/providers/credentials') {
      const body = await readBody(request)
      const provider = String(body.provider || '').trim()
      const apiKey = String(body.apiKey || '').trim()
      if (!provider || !apiKey) return send(response, 400, { error: 'provider_and_api_key_required' }, origin)
      storeCredential(provider, apiKey)
      await audit(user, 'provider.credential_updated', providerKey(provider))
      return send(response, 200, { provider: providerKey(provider), configured: true }, origin)
    }
    if (request.method === 'POST' && path === '/v1/admin/models') {
      const body = await readBody(request)
      if (!body.name || !body.provider || !['text', 'image', 'video'].includes(body.kind)) return send(response, 400, { error: 'invalid_model_record' }, origin)
      const apiKey = String(body.apiKey || '').trim()
      if (apiKey) storeCredential(body.provider, apiKey)
      const hasCredential = Boolean(credentialFor(body.provider))
      const priceNanoUsd = toNanoUsd(body.priceUsd || 0)
      if (priceNanoUsd === null) return send(response, 400, { error: 'invalid_model_price' }, origin)
      if (body.thinkingMode !== undefined && !THINKING_MODES.includes(body.thinkingMode)) return send(response, 400, { error: 'invalid_thinking_mode' }, origin)
      if (body.textApi !== undefined && !TEXT_APIS.includes(body.textApi)) return send(response, 400, { error: 'invalid_text_api' }, origin)
      if (body.contextTurns !== undefined && (!Number.isFinite(Number(body.contextTurns)) || Number(body.contextTurns) < 0 || Number(body.contextTurns) > MAX_CONTEXT_TURNS)) {
        return send(response, 400, { error: 'invalid_context_turns' }, origin)
      }
      const created = { id: randomUUID(), name: String(body.name).trim(), description: String(body.description || '').trim().slice(0, 500), provider: String(body.provider).trim(), kind: body.kind, endpoint: String(body.endpoint || '').trim() || null, status: hasCredential ? (body.status === 'beta' ? 'beta' : 'active') : 'disabled', priceNanoUsd, thinkingMode: body.thinkingMode || 'disabled', textApi: body.textApi || 'chat_completions', contextTurns: body.contextTurns === undefined ? 8 : Math.floor(Number(body.contextTurns)), createdAt: new Date().toISOString() }
      db.models.push(created)
      await audit(user, 'model.created', created.id, { provider: created.provider, kind: created.kind, credentialUpdated: Boolean(apiKey) })
      return send(response, 201, { model: safeModel(created) }, origin)
    }

    if (request.method === 'GET' && path === '/v1/admin/providers') {
      return send(response, 200, { providers: db.credentials.map(item => ({ provider: item.provider, configured: true, updatedAt: item.updatedAt })) }, origin)
    }

    const modelMatch = path.match(/^\/v1\/admin\/models\/([^/]+)$/)
    if (modelMatch && request.method === 'PATCH') {
      const target = db.models.find(item => item.id === modelMatch[1])
      if (!target || target.archivedAt) return send(response, 404, { error: 'model_not_found' }, origin)
      const body = await readBody(request)
      if (['active', 'beta', 'disabled'].includes(body.status)) target.status = body.status
      if (body.name !== undefined && String(body.name).trim()) target.name = String(body.name).trim().slice(0, 120)
      if (body.description !== undefined) target.description = String(body.description).trim().slice(0, 500)
      if (body.provider !== undefined && String(body.provider).trim()) target.provider = String(body.provider).trim().slice(0, 120)
      if (body.kind !== undefined) {
        if (!['text', 'image', 'video'].includes(body.kind)) return send(response, 400, { error: 'invalid_model_kind' }, origin)
        target.kind = body.kind
      }
      if (body.endpoint !== undefined) target.endpoint = String(body.endpoint).trim().slice(0, 300) || null
      if (body.thinkingMode !== undefined) {
        if (!THINKING_MODES.includes(body.thinkingMode)) return send(response, 400, { error: 'invalid_thinking_mode' }, origin)
        target.thinkingMode = body.thinkingMode
      }
      if (body.textApi !== undefined) {
        if (!TEXT_APIS.includes(body.textApi)) return send(response, 400, { error: 'invalid_text_api' }, origin)
        target.textApi = body.textApi
      }
      if (body.contextTurns !== undefined) {
        const parsed = Number(body.contextTurns)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_CONTEXT_TURNS) return send(response, 400, { error: 'invalid_context_turns' }, origin)
        target.contextTurns = Math.floor(parsed)
      }
      if (body.priceUsd !== undefined) {
        const priceNanoUsd = toNanoUsd(body.priceUsd)
        if (priceNanoUsd === null) return send(response, 400, { error: 'invalid_model_price' }, origin)
        target.priceNanoUsd = priceNanoUsd
      }
      const apiKey = String(body.apiKey || '').trim()
      if (apiKey) storeCredential(target.provider, apiKey)
      await audit(user, 'model.updated', target.id, { status: target.status, provider: target.provider, kind: target.kind, credentialUpdated: Boolean(apiKey) })
      return send(response, 200, { model: safeModel(target) }, origin)
    }
    if (modelMatch && request.method === 'DELETE') {
      const removed = db.models.find(item => item.id === modelMatch[1])
      if (!removed || removed.archivedAt) return send(response, 404, { error: 'model_not_found' }, origin)
      removed.status = 'disabled'
      removed.archivedAt = new Date().toISOString()
      await audit(user, 'model.archived', removed.id, { name: removed.name })
      return send(response, 200, { removed: true }, origin)
    }

    if (request.method === 'GET' && path === '/v1/admin/audit') {
      const { page, nextCursor } = pageRows(db.audit, url)
      return send(response, 200, { events: page, nextCursor }, origin)
    }
    if (request.method === 'GET' && path === '/v1/admin/balances') return send(response, 200, { balances: db.balances }, origin)
    if (request.method === 'POST' && path === '/v1/admin/reconcile') {
      await reconcilePendingGenerations()
      let providerSync
      try {
        providerSync = await syncFalAccount()
        await audit(user, 'provider.synced', 'fal.ai', providerSync)
      } catch (error) {
        providerSync = { provider: 'fal.ai', configured: true, synced: false, error: error instanceof Error ? error.message.slice(0, 300) : 'provider_sync_failed' }
        await audit(user, 'provider.sync_failed', 'fal.ai', { error: providerSync.error })
      }
      return send(response, 200, { reconciled: true, providerSync }, origin)
    }
    return send(response, 404, { error: 'not_found' }, origin)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'unknown'
    if (code === 'invalid_json' || code === 'body_too_large' || code === 'empty_file') return send(response, 400, { error: code }, origin)
    if (code === 'file_too_large') return send(response, 413, { error: code }, origin)
    console.error(error)
    return send(response, 500, { error: 'internal_error' }, origin)
  }
})

const reconciliationTimer = setInterval(() => void reconcilePendingGenerations(), 10000)
reconciliationTimer.unref()
const providerSyncTimer = setInterval(() => void syncFalAccount().catch(error => console.error('fal_account_sync_failed', error)), 60 * 60 * 1000)
providerSyncTimer.unref()

server.listen(port, host, () => {
  console.log('Cresco API listening on http://' + host + ':' + port)
  if (process.env.NODE_ENV !== 'production' && !process.env.CRESCO_ADMIN_PASSWORD) {
    console.log('Local preview admin: admin@cresco.local / admin-preview')
    console.log('Local preview member: jamie@cresco.local / member-preview')
  }
})
