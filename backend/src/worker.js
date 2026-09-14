const WORKSPACE_ID = 'default'
const MAX_JSON_BYTES = 1024 * 1024
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const TOKEN_TTL_SECONDS = 12 * 60 * 60
const ASSET_TTL_SECONDS = 24 * 60 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

class ApiError extends Error {
  constructor(status, code, details = {}) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

function nowIso() {
  return new Date().toISOString()
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages)
}

async function hashPassword(password, env) {
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const verifier = await crypto.subtle.sign('HMAC', await hmacKey(requiredSecret(env, 'CRESCO_PASSWORD_PEPPER'), ['sign']), encoder.encode(`${salt}:${password}`))
  return `hmac-sha256:${salt}:${bytesToBase64Url(verifier)}`
}

async function verifyPassword(password, stored, env) {
  const [scheme, salt, expected] = String(stored || '').split(':')
  if (scheme !== 'hmac-sha256' || !salt || !expected) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(requiredSecret(env, 'CRESCO_PASSWORD_PEPPER'), ['verify']),
    base64UrlToBytes(expected),
    encoder.encode(`${salt}:${password}`),
  ).catch(() => false)
}

async function encryptionKey(env) {
  const raw = await digest(requiredSecret(env, 'CRESCO_ENCRYPTION_KEY'))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptSecret(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), encoder.encode(value))
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`
}

async function decryptSecret(value, env) {
  const [ivText, encryptedText] = String(value || '').split('.')
  if (!ivText || !encryptedText) throw new Error('invalid_encrypted_secret')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivText) }, await encryptionKey(env), base64UrlToBytes(encryptedText))
  return decoder.decode(decrypted)
}

function requiredSecret(env, key) {
  const value = String(env[key] || '')
  if (value.length < 24 || value.includes('replace-with')) throw new ApiError(503, 'service_not_configured', { missing: key })
  return value
}

async function signToken(user, env) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    sub: user.id,
    role: user.role,
    sv: user.sessionVersion || 1,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  })))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(requiredSecret(env, 'CRESCO_TOKEN_SECRET'), ['sign']), encoder.encode(payload))
  return `${payload}.${bytesToBase64Url(signature)}`
}

async function verifyToken(token, env) {
  const [payload, signatureText] = String(token || '').split('.')
  if (!payload || !signatureText) return null
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(requiredSecret(env, 'CRESCO_TOKEN_SECRET'), ['verify']), base64UrlToBytes(signatureText), encoder.encode(payload))
    if (!valid) return null
    const claims = JSON.parse(decoder.decode(base64UrlToBytes(payload)))
    return claims.exp >= Date.now() / 1000 ? claims : null
  } catch {
    return null
  }
}

async function first(env, sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).first()
}

async function all(env, sql, ...bindings) {
  const result = await env.DB.prepare(sql).bind(...bindings).all()
  return result.results || []
}

async function run(env, sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).run()
}

function providerKey(provider) {
  const value = String(provider || '').trim().toLowerCase()
  if (value.includes('fal.ai') || value === 'fal') return 'fal.ai'
  if (value.includes('byteplus') || value.includes('modelark')) return 'byteplus'
  if (value.includes('openai')) return 'openai'
  if (value.includes('anthropic')) return 'anthropic'
  if (value.includes('google')) return 'google'
  return value
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

function providerTimeoutMs(env, kind, streaming = false) {
  if (kind !== 'text') return positiveInt(env.CRESCO_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS)
  if (streaming) return positiveInt(env.CRESCO_TEXT_STREAM_TIMEOUT_MS, DEFAULT_TEXT_STREAM_TIMEOUT_MS)
  return positiveInt(env.CRESCO_TEXT_TIMEOUT_MS, DEFAULT_TEXT_TIMEOUT_MS)
}

const DEFAULT_MAX_QUEUED_MINUTES = { text: 10, image: 20, video: 60 }
// A job the cron has been re-picking for this long is not going to finish. It is
// failed with a reason rather than left showing "Processing" forever.
function maxQueuedMs(env, kind) {
  const override = positiveInt(env.CRESCO_MAX_QUEUED_MINUTES, 0)
  const minutes = override || DEFAULT_MAX_QUEUED_MINUTES[kind] || 30
  return minutes * 60000
}

// The cron is the safety net behind the queue. A row nothing has touched for this
// long is processed directly, so a missing or broken queue consumer cannot strand it.
const STALE_QUEUED_MS = 120000

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
// generation as last_provider_error so the cause stays diagnosable.
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

// 'auto' leaves the decision to the provider default; anything else is explicit,
// and 'disabled' is the default because a reasoning pass is the main reason a
// flash-class model takes longer than the request timeout.
function textRequestBody(model, prompt, { stream = false } = {}) {
  const mode = thinkingMode(model)
  const thinking = mode === 'auto' ? {} : { thinking: { type: mode } }
  if (textApi(model) === 'responses') {
    return { model: model.endpoint, input: prompt, ...thinking, ...(stream ? { stream: true } : {}) }
  }
  return {
    model: model.endpoint,
    messages: [{ role: 'user', content: prompt }],
    ...thinking,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  }
}

function userFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    sessionVersion: Number(row.session_version || 1),
    preferences: parseJson(row.preferences_json, {}),
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }
}

function safeUser(user) {
  const { passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...safe } = user
  return safe
}

function modelFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    provider: row.provider,
    kind: row.kind,
    endpoint: row.endpoint,
    status: row.status,
    priceNanoUsd: Number(row.price_nano_usd || 0),
    thinkingMode: THINKING_MODES.includes(row.thinking_mode) ? row.thinking_mode : 'disabled',
    textApi: TEXT_APIS.includes(row.text_api) ? row.text_api : 'chat_completions',
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  }
}

function uploadFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    fileName: row.file_name,
    contentType: row.content_type,
    size: Number(row.byte_size || 0),
    storageKey: row.storage_key,
    createdAt: row.created_at,
  }
}

function safeUpload(upload) {
  const { storageKey: _storageKey, ...safe } = upload
  return safe
}

function generationFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    title: row.title,
    modelId: row.model_id,
    modelName: row.model_name,
    modelProvider: row.model_provider,
    kind: row.kind,
    prompt: row.prompt,
    options: parseJson(row.options_json, {}),
    status: row.status,
    providerRequestId: row.provider_request_id,
    providerStatusUrl: row.provider_status_url,
    providerResponseUrl: row.provider_response_url,
    providerState: row.provider_state,
    result: parseJson(row.result_json, null),
    resultUrl: row.result_url,
    estimatedCostNanoUsd: Number(row.estimated_cost_nano_usd || 0),
    costNanoUsd: Number(row.cost_nano_usd || 0),
    costSource: row.cost_source,
    error: row.error,
    lastProviderError: row.last_provider_error,
    lastProviderAttemptAt: row.last_provider_attempt_at,
    pollAttempts: Number(row.poll_attempts || 0),
    providerLatencyMs: row.provider_latency_ms === null || row.provider_latency_ms === undefined ? null : Number(row.provider_latency_ms),
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
    completedAt: row.completed_at,
    references: [],
  }
}

function safeGeneration(generation) {
  const {
    userId: _userId,
    result: _result,
    providerStatusUrl: _providerStatusUrl,
    providerResponseUrl: _providerResponseUrl,
    estimatedCostNanoUsd: _estimated,
    pollAttempts: _pollAttempts,
    lastProviderError: _lastProviderError,
    lastProviderAttemptAt: _lastProviderAttemptAt,
    ...safe
  } = generation
  const queuedForMs = generation.status === 'queued' ? Date.now() - Date.parse(generation.createdAt) : null
  return {
    ...safe,
    outputText: providerOutputText(generation.result),
    queuedForMs: Number.isFinite(queuedForMs) ? queuedForMs : null,
    references: (generation.references || []).map(safeUpload),
  }
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const allowed = new Set(String(env.CRESCO_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))
  return allowed.has(origin) ? origin : null
}

function responseHeaders(origin, extra = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...extra,
  })
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.set('vary', 'Origin')
  }
  return headers
}

function json(body, status, origin, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin, extraHeaders) })
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_JSON_BYTES) throw new ApiError(413, 'body_too_large')
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > MAX_JSON_BYTES) throw new ApiError(413, 'body_too_large')
  if (!buffer.byteLength) return {}
  try {
    return JSON.parse(decoder.decode(buffer))
  } catch {
    throw new ApiError(400, 'invalid_json')
  }
}

function toNanoUsd(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return null
  return Math.round(amount * 1000000000)
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

function pageLimit(url, fallback = 100) {
  const requested = Number(url.searchParams.get('limit') || fallback)
  return Math.min(250, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : fallback))
}

async function ensureInitialized(env) {
  requiredSecret(env, 'CRESCO_TOKEN_SECRET')
  requiredSecret(env, 'CRESCO_ENCRYPTION_KEY')
  requiredSecret(env, 'CRESCO_PASSWORD_PEPPER')
  const admin = await first(env, "SELECT id FROM users WHERE workspace_id = ? AND role = 'admin' LIMIT 1", WORKSPACE_ID)
  if (admin) return
  const email = String(env.CRESCO_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(env.CRESCO_ADMIN_PASSWORD || '')
  if (!email || password.length < 10) throw new ApiError(503, 'bootstrap_admin_not_configured')
  const createdAt = nowIso()
  const id = crypto.randomUUID()
  await run(env, `INSERT OR IGNORE INTO users
    (id, workspace_id, name, email, password_hash, role, status, session_version, preferences_json, created_at)
    VALUES (?, ?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
    id, WORKSPACE_ID, 'Workspace Owner', email, await hashPassword(password, env), JSON.stringify({ generationCompleted: true, weeklySummary: true, generationFailed: true }), createdAt)
  await run(env, `INSERT INTO audit_events
    (id, workspace_id, actor_id, actor_email, action, target, metadata_json, created_at)
    VALUES (?, ?, NULL, ?, 'system.bootstrap_admin', ?, '{}', ?)`, crypto.randomUUID(), WORKSPACE_ID, email, id, createdAt)
}

async function authenticate(request, env) {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const claims = await verifyToken(token, env)
  if (!claims?.sub) return null
  const row = await first(env, 'SELECT * FROM users WHERE id = ? AND workspace_id = ?', claims.sub, WORKSPACE_ID)
  const user = userFromRow(row)
  if (!user || user.status !== 'active' || user.sessionVersion !== claims.sv) return null
  return user
}

async function audit(env, user, action, target, metadata = {}) {
  await run(env, `INSERT INTO audit_events
    (id, workspace_id, actor_id, actor_email, action, target, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(), WORKSPACE_ID, user?.id || null, user?.email || 'anonymous', action, target, JSON.stringify(metadata), nowIso())
}

async function loginRateLimited(request, email, env) {
  const identity = `${request.headers.get('cf-connecting-ip') || 'unknown'}:${email}`
  const key = bytesToBase64Url(await digest(identity))
  const windowStartedAt = Math.floor(Date.now() / 60000) * 60000
  const current = await first(env, 'SELECT window_started_at, request_count FROM login_rate_limits WHERE key = ?', key)
  if (current && Number(current.window_started_at) === windowStartedAt) {
    if (Number(current.request_count) >= 20) return true
    await run(env, 'UPDATE login_rate_limits SET request_count = request_count + 1 WHERE key = ?', key)
    return false
  }
  await run(env, `INSERT INTO login_rate_limits (key, window_started_at, request_count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = 1`, key, windowStartedAt)
  return false
}

async function credentialFor(env, provider) {
  return first(env, 'SELECT * FROM provider_credentials WHERE workspace_id = ? AND provider_key = ?', WORKSPACE_ID, providerKey(provider))
}

async function storeCredential(env, provider, apiKey) {
  const normalized = providerKey(provider)
  const encrypted = await encryptSecret(String(apiKey), env)
  const timestamp = nowIso()
  await run(env, `INSERT INTO provider_credentials
    (id, workspace_id, provider_key, encrypted_api_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, provider_key) DO UPDATE SET encrypted_api_key = excluded.encrypted_api_key, updated_at = excluded.updated_at`,
    crypto.randomUUID(), WORKSPACE_ID, normalized, encrypted, timestamp, timestamp)
  return normalized
}

async function safeModels(env, rows) {
  const credentials = await all(env, 'SELECT provider_key FROM provider_credentials WHERE workspace_id = ?', WORKSPACE_ID)
  const configured = new Set(credentials.map(item => String(item.provider_key).toLowerCase()))
  return rows.map(modelFromRow).map(model => {
    const credentialConfigured = configured.has(providerKey(model.provider))
    const adapterConfigured = ['fal.ai', 'byteplus'].includes(providerKey(model.provider))
    return {
      ...model,
      credentialConfigured,
      adapterConfigured,
      executionReady: Boolean(credentialConfigured && adapterConfigured && model.endpoint && model.status !== 'disabled' && !model.archivedAt),
    }
  })
}

async function attachReferences(env, generations) {
  if (!generations.length) return generations
  const placeholders = generations.map(() => '?').join(',')
  const rows = await all(env, `SELECT gr.generation_id, u.* FROM generation_references gr
    JOIN uploads u ON u.id = gr.upload_id WHERE gr.generation_id IN (${placeholders}) ORDER BY u.created_at`, ...generations.map(item => item.id))
  const grouped = new Map()
  for (const row of rows) {
    const values = grouped.get(row.generation_id) || []
    values.push(uploadFromRow(row))
    grouped.set(row.generation_id, values)
  }
  for (const generation of generations) generation.references = grouped.get(generation.id) || []
  return generations
}

async function historyPage(env, user, url) {
  const limit = pageLimit(url)
  const cursor = url.searchParams.get('cursor')
  const cursorRow = cursor ? await first(env, 'SELECT id, created_at FROM generations WHERE id = ? AND workspace_id = ?', cursor, WORKSPACE_ID) : null
  const bindings = [WORKSPACE_ID]
  const clauses = ['workspace_id = ?']
  if (user.role !== 'admin') {
    clauses.push('user_id = ?')
    bindings.push(user.id)
  }
  if (cursorRow) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    bindings.push(cursorRow.created_at, cursorRow.created_at, cursorRow.id)
  }
  bindings.push(limit + 1)
  const rows = await all(env, `SELECT * FROM generations WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`, ...bindings)
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).map(generationFromRow)
  await attachReferences(env, page)
  return { generations: page.map(safeGeneration), nextCursor: hasMore ? page.at(-1)?.id || null : null }
}

async function usageSummary(env) {
  const byModelRows = await all(env, `SELECT m.id AS model_id, m.name, m.provider,
    COUNT(g.id) AS calls, COALESCE(SUM(g.cost_nano_usd), 0) AS spend_nano_usd
    FROM models m LEFT JOIN generations g ON g.model_id = m.id
    WHERE m.workspace_id = ? GROUP BY m.id, m.name, m.provider ORDER BY spend_nano_usd DESC`, WORKSPACE_ID)
  const byMemberRows = await all(env, `SELECT user_email AS email, COUNT(*) AS calls,
    COALESCE(SUM(cost_nano_usd), 0) AS spend_nano_usd FROM generations
    WHERE workspace_id = ? GROUP BY user_email ORDER BY spend_nano_usd DESC`, WORKSPACE_ID)
  const month = new Date()
  month.setUTCDate(1)
  month.setUTCHours(0, 0, 0, 0)
  const monthly = await first(env, `SELECT COALESCE(SUM(cost_nano_usd), 0) AS spend,
    COALESCE(SUM(CASE WHEN status = 'queued' THEN estimated_cost_nano_usd ELSE cost_nano_usd END), 0) AS committed
    FROM generations WHERE workspace_id = ? AND created_at >= ?`, WORKSPACE_ID, month.toISOString())
  const policy = await first(env, 'SELECT * FROM budget_policies WHERE workspace_id = ?', WORKSPACE_ID)
  const balances = await all(env, 'SELECT provider, amount_nano_usd, source, synced_at FROM provider_balances WHERE workspace_id = ? ORDER BY provider', WORKSPACE_ID)
  const providerUsageRows = await all(env, `SELECT provider, period_start, endpoint_id, quantity, cost_nano_usd, currency, synced_at
    FROM provider_usage_snapshots WHERE workspace_id = ? AND period_start = (
      SELECT MAX(period_start) FROM provider_usage_snapshots WHERE workspace_id = ?
    ) ORDER BY cost_nano_usd DESC`, WORKSPACE_ID, WORKSPACE_ID)
  const byModel = byModelRows.map(item => ({
    modelId: item.model_id,
    name: item.name,
    provider: item.provider,
    calls: Number(item.calls || 0),
    spendNanoUsd: Number(item.spend_nano_usd || 0),
  }))
  return {
    spendNanoUsd: byModel.reduce((sum, item) => sum + item.spendNanoUsd, 0),
    calls: byModel.reduce((sum, item) => sum + item.calls, 0),
    byModel,
    byMember: byMemberRows.map(item => ({ email: item.email, calls: Number(item.calls || 0), spendNanoUsd: Number(item.spend_nano_usd || 0) })),
    monthlySpendNanoUsd: Number(monthly?.spend || 0),
    monthlyCommittedNanoUsd: Number(monthly?.committed || 0),
    budget: {
      workspaceMonthlyLimitNanoUsd: Number(policy?.workspace_monthly_limit_nano_usd || 0),
      perGenerationLimitNanoUsd: Number(policy?.per_generation_limit_nano_usd || 0),
      warnAtPercent: Number(policy?.warn_at_percent || 80),
    },
    balances: balances.map(item => ({ provider: item.provider, amountNanoUsd: Number(item.amount_nano_usd || 0), source: item.source, syncedAt: item.synced_at })),
    providerUsage: providerUsageRows.length ? {
      periodStart: providerUsageRows[0].period_start,
      spendNanoUsd: providerUsageRows.reduce((sum, item) => sum + Number(item.cost_nano_usd || 0), 0),
      syncedAt: providerUsageRows.reduce((latest, item) => String(item.synced_at) > latest ? String(item.synced_at) : latest, ''),
      byEndpoint: providerUsageRows.map(item => ({
        provider: item.provider,
        endpointId: item.endpoint_id,
        quantity: Number(item.quantity || 0),
        spendNanoUsd: Number(item.cost_nano_usd || 0),
        currency: item.currency,
      })),
    } : null,
  }
}

async function signAssetReference(id, expires, env) {
  const secret = String(env.CRESCO_ASSET_SIGNING_SECRET || requiredSecret(env, 'CRESCO_TOKEN_SECRET'))
  const value = `${id}:${expires}`
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), encoder.encode(value))
  return bytesToBase64Url(signature)
}

async function providerAssetResponse(request, env, id) {
  const url = new URL(request.url)
  const expires = Number(url.searchParams.get('expires') || 0)
  const signature = url.searchParams.get('signature') || ''
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) throw new ApiError(403, 'asset_link_expired')
  const secret = String(env.CRESCO_ASSET_SIGNING_SECRET || requiredSecret(env, 'CRESCO_TOKEN_SECRET'))
  let signatureBytes
  try {
    signatureBytes = base64UrlToBytes(signature)
  } catch {
    throw new ApiError(403, 'invalid_asset_signature')
  }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), signatureBytes, encoder.encode(`${id}:${expires}`)).catch(() => false)
  if (!valid) throw new ApiError(403, 'invalid_asset_signature')
  const row = await first(env, 'SELECT * FROM uploads WHERE id = ? AND workspace_id = ?', id, WORKSPACE_ID)
  if (!row) throw new ApiError(404, 'upload_not_found')
  const upload = uploadFromRow(row)
  const object = await env.UPLOADS.get(upload.storageKey)
  if (!object) throw new ApiError(404, 'upload_object_not_found')
  const headers = new Headers({
    'content-type': upload.contentType,
    'content-length': String(upload.size),
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    etag: object.httpEtag,
  })
  return new Response(object.body, { status: 200, headers })
}

async function providerAssetUrl(upload, env) {
  const base = String(env.CRESCO_PUBLIC_API_URL || '').replace(/\/$/, '')
  if (!/^https:\/\//i.test(base)) throw new Error('public_api_url_not_configured')
  const expires = Math.floor(Date.now() / 1000) + ASSET_TTL_SECONDS
  const signature = await signAssetReference(upload.id, expires, env)
  return `${base}/v1/provider-assets/${encodeURIComponent(upload.id)}?expires=${expires}&signature=${encodeURIComponent(signature)}`
}

async function falInput(generation, user, env) {
  const input = { prompt: generation.prompt, end_user_id: user.id }
  const aspect = generation.options?.aspect
  const quality = generation.options?.quality
  const duration = generation.options?.duration
  if (aspect && aspect !== 'Auto') input.aspect_ratio = aspect
  if (quality && /^\d+p$/.test(quality)) input.resolution = quality
  if (duration) input.duration = String(duration).replace(/\s*seconds?$/i, '')
  for (const upload of generation.references || []) {
    const url = await providerAssetUrl(upload, env)
    if (!url) continue
    if (upload.contentType.startsWith('image/') && !input.image_url) input.image_url = url
    if (upload.contentType.startsWith('video/') && !input.video_url) input.video_url = url
    if (upload.contentType.startsWith('audio/') && !input.audio_url) input.audio_url = url
  }
  return input
}

async function falRequest(url, credential, env, init = {}) {
  const { timeoutMs = providerTimeoutMs(env), kind = null, ...rest } = init
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { authorization: `Key ${await decryptSecret(credential.encrypted_api_key, env)}`, 'content-type': 'application/json', ...(rest.headers || {}) },
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

function falPlatformBase(env) {
  return String(env.CRESCO_FAL_PLATFORM_URL || 'https://api.fal.ai/v1').replace(/\/$/, '')
}

async function falPages(path, field, credential, env, searchParams) {
  const rows = []
  let cursor = null
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${falPlatformBase(env)}/${path}`)
    for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, String(value))
    if (cursor) url.searchParams.set('cursor', cursor)
    const data = await falRequest(url.toString(), credential, env)
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

async function reconcileFalGenerationCosts(env, credential) {
  const generations = await all(env, `SELECT id, provider_request_id FROM generations
    WHERE workspace_id = ? AND status = 'complete' AND provider_request_id IS NOT NULL
      AND (cost_source IS NULL OR cost_source != 'provider') AND LOWER(model_provider) LIKE '%fal%'
    ORDER BY completed_at DESC LIMIT 250`, WORKSPACE_ID)
  let updated = 0
  for (let offset = 0; offset < generations.length; offset += 50) {
    const batch = generations.slice(offset, offset + 50)
    const events = await falPages('models/billing-events', 'billing_events', credential, env, {
      request_id: batch.map(item => item.provider_request_id).join(','),
      limit: 10000,
    })
    const byRequest = new Map(events.map(event => [String(event.request_id), event]))
    for (const generation of batch) {
      const cost = billingEventCost(byRequest.get(String(generation.provider_request_id)))
      if (cost === null) continue
      await run(env, "UPDATE generations SET cost_nano_usd = ?, cost_source = 'provider' WHERE id = ?", cost, generation.id)
      updated += 1
    }
  }
  return updated
}

async function syncFalUsage(env, credential, syncedAt) {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date()
  end.setUTCDate(end.getUTCDate() + 1)
  end.setUTCHours(0, 0, 0, 0)
  const buckets = await falPages('models/usage', 'time_series', credential, env, {
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: 'UTC',
    timeframe: 'day',
    bound_to_timeframe: 'false',
    expand: 'time_series',
    limit: 1000,
  })
  const byEndpoint = new Map()
  for (const bucket of buckets) {
    for (const item of Array.isArray(bucket.results) ? bucket.results : []) {
      const endpointId = String(item.endpoint_id || 'unknown')
      const current = byEndpoint.get(endpointId) || { quantity: 0, costNanoUsd: 0, currency: String(item.currency || 'USD') }
      current.quantity += Number(item.quantity || 0)
      current.costNanoUsd += billingEventCost(item) || 0
      byEndpoint.set(endpointId, current)
    }
  }
  await run(env, 'DELETE FROM provider_usage_snapshots WHERE workspace_id = ? AND provider = ? AND period_start = ?', WORKSPACE_ID, 'fal.ai', start.toISOString())
  for (const [endpointId, item] of byEndpoint) {
    await run(env, `INSERT INTO provider_usage_snapshots
      (workspace_id, provider, period_start, endpoint_id, quantity, cost_nano_usd, currency, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      WORKSPACE_ID, 'fal.ai', start.toISOString(), endpointId, item.quantity, item.costNanoUsd, item.currency, syncedAt)
  }
  return {
    periodStart: start.toISOString(),
    endpoints: byEndpoint.size,
    spendNanoUsd: [...byEndpoint.values()].reduce((sum, item) => sum + item.costNanoUsd, 0),
  }
}

async function syncFalAccount(env) {
  const credential = await credentialFor(env, 'fal.ai')
  if (!credential) return { provider: 'fal.ai', configured: false, synced: false }
  const syncedAt = nowIso()
  const billing = await falRequest(`${falPlatformBase(env)}/account/billing?expand=credits`, credential, env)
  const balanceNanoUsd = toNanoUsd(billing?.credits?.current_balance)
  if (balanceNanoUsd === null) throw new Error('fal_balance_missing')
  if (String(billing?.credits?.currency || 'USD').toUpperCase() !== 'USD') throw new Error('fal_balance_currency_unsupported')
  await run(env, `INSERT INTO provider_balances (workspace_id, provider, amount_nano_usd, source, synced_at)
    VALUES (?, ?, ?, 'provider', ?)
    ON CONFLICT(workspace_id, provider) DO UPDATE SET amount_nano_usd = excluded.amount_nano_usd, source = 'provider', synced_at = excluded.synced_at`,
    WORKSPACE_ID, 'fal.ai', balanceNanoUsd, syncedAt)
  const [reconciledCosts, usage] = await Promise.all([
    reconcileFalGenerationCosts(env, credential),
    syncFalUsage(env, credential, syncedAt),
  ])
  return { provider: 'fal.ai', configured: true, synced: true, balanceNanoUsd, reconciledCosts, usage, syncedAt }
}

function bytePlusBase(env) {
  return String(env.CRESCO_BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '')
}

async function bytePlusRequest(url, credential, env, init = {}) {
  const { timeoutMs = providerTimeoutMs(env), kind = null, ...rest } = init
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { authorization: `Bearer ${await decryptSecret(credential.encrypted_api_key, env)}`, 'content-type': 'application/json', ...(rest.headers || {}) },
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

async function bytePlusReferences(generation, env) {
  const items = []
  for (const upload of generation.references || []) {
    const url = await providerAssetUrl(upload, env)
    if (upload.contentType.startsWith('image/')) items.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    else if (upload.contentType.startsWith('video/')) items.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
    else if (upload.contentType.startsWith('audio/')) items.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
  }
  return items
}

async function dispatchBytePlusGeneration(env, generation, model, credential) {
  const base = bytePlusBase(env)
  const timeoutMs = providerTimeoutMs(env, model.kind)
  if (model.kind === 'text') {
    const result = await bytePlusRequest(`${base}${textRequestPath(model)}`, credential, env, {
      method: 'POST', kind: model.kind, timeoutMs,
      body: JSON.stringify(textRequestBody(model, generation.prompt)),
    })
    return { asynchronous: false, result, requestId: result.id || null }
  }
  const references = await bytePlusReferences(generation, env)
  if (model.kind === 'image') {
    const images = references.filter(item => item.type === 'image_url').map(item => item.image_url.url)
    const body = {
      model: model.endpoint,
      prompt: generation.prompt,
      response_format: 'url',
      watermark: false,
      ...(generation.options?.quality === 'High' ? { size: '2K' } : {}),
      ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
    }
    const result = await bytePlusRequest(`${base}/images/generations`, credential, env, { method: 'POST', kind: model.kind, timeoutMs, body: JSON.stringify(body) })
    return { asynchronous: false, result, requestId: result.id || null }
  }
  const body = {
    model: model.endpoint,
    content: [{ type: 'text', text: generation.prompt }, ...references],
    watermark: false,
    ...(generation.options?.aspect ? { ratio: generation.options.aspect } : {}),
    ...(generation.options?.quality ? { resolution: generation.options.quality } : {}),
    ...(generation.options?.duration ? { duration: Number(String(generation.options.duration).replace(/\D/g, '')) || undefined } : {}),
  }
  const result = await bytePlusRequest(`${base}/contents/generations/tasks`, credential, env, { method: 'POST', kind: model.kind, timeoutMs, body: JSON.stringify(body) })
  if (!result.id) throw new Error('byteplus_task_id_missing')
  const statusUrl = `${base}/contents/generations/tasks/${encodeURIComponent(result.id)}`
  return { asynchronous: true, result, requestId: result.id, statusUrl }
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

async function* bytePlusTextStream(env, prompt, model, credential) {
  const url = `${bytePlusBase(env)}${textRequestPath(model)}`
  const timeoutMs = providerTimeoutMs(env, 'text', true)
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await decryptSecret(credential.encrypted_api_key, env)}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(textRequestBody(model, prompt, { stream: true })),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: false, durationMs: Date.now() - startedAt, timeoutMs, error: String(error?.name || 'FetchError') })
    throw providerFailure(error, timeoutMs)
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: false, status: response.status, durationMs: Date.now() - startedAt })
    throw new Error(data?.error?.message || data?.message || `byteplus_request_failed_${response.status}`)
  }
  const reader = response.body.getReader()
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
    logProviderCall({ provider: 'byteplus', kind: 'text', path: requestPath(url), stream: true, ok: true, status: response.status, firstDeltaMs, durationMs: Date.now() - startedAt })
  }
}

// Streaming keeps the member-visible wait at time-to-first-token instead of the
// full completion. The generation row is finalised before the stream closes so a
// reload shows the same result the stream delivered.
function streamTextGeneration(env, ctx, { generation, model, credential, origin }) {
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const send = (event, data) => writer.write(encoder.encode(sseFrame(event, data)))

  const work = async () => {
    const startedAt = Date.now()
    let text = ''
    let usage = null
    let requestId = null
    try {
      await send('meta', { generation: safeGeneration(generation) })
      await run(env, `UPDATE generations SET provider_state = 'streaming', dispatched_at = ? WHERE id = ?`, nowIso(), generation.id)
      for await (const chunk of bytePlusTextStream(env, generation.prompt, model, credential)) {
        if (chunk.requestId) requestId = chunk.requestId
        if (chunk.usage) usage = chunk.usage
        if (!chunk.delta) continue
        text += chunk.delta
        await send('delta', { text: chunk.delta })
      }
      if (!text) throw new Error('provider_empty_response')
      const result = {
        id: requestId,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: text } }],
        ...(usage ? { usage } : {}),
      }
      await run(env, `UPDATE generations SET status = 'complete', provider_request_id = ?, provider_state = 'succeeded', result_json = ?,
        cost_nano_usd = estimated_cost_nano_usd, cost_source = CASE WHEN estimated_cost_nano_usd > 0 THEN 'catalog_estimate' ELSE 'pending_reconciliation' END,
        completed_at = ?, provider_latency_ms = ?, last_provider_error = NULL WHERE id = ?`,
        requestId, JSON.stringify(result), nowIso(), Date.now() - startedAt, generation.id)
      const final = generationFromRow(await first(env, 'SELECT * FROM generations WHERE id = ? AND workspace_id = ?', generation.id, WORKSPACE_ID))
      await attachReferences(env, [final])
      await send('done', { generation: safeGeneration(final) })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'provider_stream_failed'
      await run(env, `UPDATE generations SET status = 'failed', provider_state = 'stream_failed', error = ?, last_provider_error = ?,
        completed_at = ?, provider_latency_ms = ? WHERE id = ?`,
        message, providerDetail(error).slice(0, 500), nowIso(), Date.now() - startedAt, generation.id)
      await send('error', { error: message }).catch(() => {})
    } finally {
      await writer.close().catch(() => {})
    }
  }

  ctx.waitUntil(work())
  return new Response(readable, {
    status: 200,
    headers: responseHeaders(origin, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' }),
  })
}

async function generationContext(env, id) {
  const generationRow = await first(env, 'SELECT * FROM generations WHERE id = ? AND workspace_id = ?', id, WORKSPACE_ID)
  const generation = generationFromRow(generationRow)
  if (!generation) return null
  await attachReferences(env, [generation])
  const model = modelFromRow(await first(env, 'SELECT * FROM models WHERE id = ?', generation.modelId))
  const user = userFromRow(await first(env, 'SELECT * FROM users WHERE id = ?', generation.userId))
  const credential = model ? await credentialFor(env, model.provider) : null
  return { generation, model, user, credential }
}

async function dispatchGeneration(env, context) {
  const { generation, model, user, credential } = context
  const provider = model ? providerKey(model.provider) : ''
  if (!model || !user || !credential || !['fal.ai', 'byteplus'].includes(provider) || !model.endpoint) {
    await run(env, `UPDATE generations SET status = 'failed', provider_state = ?, error = ?, completed_at = ? WHERE id = ?`,
      credential ? 'adapter_required' : 'credential_required', credential ? 'provider_adapter_required' : 'provider_credential_required', nowIso(), generation.id)
    return { done: true }
  }
  const startedAt = Date.now()
  try {
    if (provider === 'fal.ai') {
      const queueBase = String(env.CRESCO_FAL_QUEUE_URL || 'https://queue.fal.run').replace(/\/$/, '')
      const data = await falRequest(`${queueBase}/${model.endpoint.replace(/^\/+/, '')}`, credential, env, {
        method: 'POST',
        kind: model.kind,
        body: JSON.stringify(await falInput(generation, user, env)),
      })
      await run(env, `UPDATE generations SET provider_request_id = ?, provider_status_url = ?, provider_response_url = ?,
        provider_state = 'submitted', dispatched_at = ?, last_provider_error = NULL WHERE id = ?`,
        data.request_id || null, data.status_url || null, data.response_url || null, nowIso(), generation.id)
      if (!data.status_url || !data.response_url) {
        await run(env, `UPDATE generations SET status = 'failed', provider_state = 'invalid_provider_response', error = 'provider_poll_urls_missing', completed_at = ? WHERE id = ?`, nowIso(), generation.id)
        return { done: true }
      }
      return { done: false, retrySeconds: 20 }
    }
    const dispatched = await dispatchBytePlusGeneration(env, generation, model, credential)
    if (dispatched.asynchronous) {
      await run(env, `UPDATE generations SET provider_request_id = ?, provider_status_url = ?, provider_response_url = ?,
        provider_state = 'submitted', dispatched_at = ?, last_provider_error = NULL WHERE id = ?`,
        dispatched.requestId, dispatched.statusUrl, dispatched.statusUrl, nowIso(), generation.id)
      return { done: false, retrySeconds: 20 }
    }
    await run(env, `UPDATE generations SET status = 'complete', provider_request_id = ?, provider_state = 'succeeded', result_json = ?, result_url = ?,
      cost_nano_usd = estimated_cost_nano_usd, cost_source = CASE WHEN estimated_cost_nano_usd > 0 THEN 'catalog_estimate' ELSE 'pending_reconciliation' END,
      dispatched_at = ?, completed_at = ?, provider_latency_ms = ?, last_provider_error = NULL WHERE id = ?`,
      dispatched.requestId, JSON.stringify(dispatched.result), resultUrl(dispatched.result), nowIso(), nowIso(), Date.now() - startedAt, generation.id)
    return { done: true }
  } catch (error) {
    await run(env, `UPDATE generations SET status = 'failed', provider_state = 'submission_failed', error = ?, last_provider_error = ?,
      completed_at = ?, provider_latency_ms = ? WHERE id = ?`,
      error instanceof Error ? error.message.slice(0, 500) : 'provider_submission_failed',
      providerDetail(error).slice(0, 500), nowIso(), Date.now() - startedAt, generation.id)
    return { done: true }
  }
}

async function reconcileGeneration(env, context) {
  const { generation, model, credential } = context
  // Without a model, a credential or poll URLs there is nothing left to poll, and
  // returning quietly would leave the row queued forever. Fail it with a reason.
  if (!model || !credential || !generation.providerStatusUrl || !generation.providerResponseUrl) {
    const reason = !model ? 'model_removed' : !credential ? 'provider_credential_removed' : 'provider_poll_urls_missing'
    await run(env, `UPDATE generations SET status = 'failed', provider_state = 'unrecoverable', error = ?, completed_at = ? WHERE id = ?`,
      reason, nowIso(), generation.id)
    return { done: true }
  }
  try {
    if (providerKey(model.provider) === 'byteplus') {
      const result = await bytePlusRequest(generation.providerStatusUrl, credential, env, { kind: 'poll' })
      const providerState = String(result.status || 'unknown').toLowerCase()
      const attempts = generation.pollAttempts + 1
      if (providerState === 'succeeded') {
        await run(env, `UPDATE generations SET status = 'complete', provider_state = ?, result_json = ?, result_url = ?,
          cost_nano_usd = estimated_cost_nano_usd, cost_source = CASE WHEN estimated_cost_nano_usd > 0 THEN 'catalog_estimate' ELSE 'pending_reconciliation' END,
          poll_attempts = ?, completed_at = ?, last_provider_error = NULL WHERE id = ?`,
          providerState, JSON.stringify(result), resultUrl(result), attempts, nowIso(), generation.id)
        return { done: true }
      }
      if (['failed', 'cancelled', 'expired'].includes(providerState)) {
        await run(env, `UPDATE generations SET status = 'failed', provider_state = ?, error = ?, poll_attempts = ?, completed_at = ? WHERE id = ?`,
          providerState, String(result?.error?.message || result?.error || `provider_${providerState}`).slice(0, 500), attempts, nowIso(), generation.id)
        return { done: true }
      }
      if (attempts >= 180) {
        await run(env, `UPDATE generations SET status = 'failed', provider_state = 'timed_out', error = 'provider_timeout', poll_attempts = ?, completed_at = ? WHERE id = ?`, attempts, nowIso(), generation.id)
        return { done: true }
      }
      await run(env, `UPDATE generations SET provider_state = ?, poll_attempts = ?, last_provider_attempt_at = ?, last_provider_error = NULL WHERE id = ?`,
        providerState, attempts, nowIso(), generation.id)
      return { done: false, retrySeconds: 20 }
    }
    const status = await falRequest(generation.providerStatusUrl, credential, env, { kind: 'poll' })
    const providerState = String(status.status || 'unknown').toLowerCase()
    const attempts = generation.pollAttempts + 1
    if (status.status === 'COMPLETED') {
      const result = await falRequest(generation.providerResponseUrl, credential, env, { kind: 'poll' })
      await run(env, `UPDATE generations SET status = 'complete', provider_state = ?, result_json = ?, result_url = ?,
        cost_nano_usd = estimated_cost_nano_usd, cost_source = CASE WHEN estimated_cost_nano_usd > 0 THEN 'catalog_estimate' ELSE 'pending_reconciliation' END,
        poll_attempts = ?, completed_at = ?, last_provider_error = NULL WHERE id = ?`,
        providerState, JSON.stringify(result), resultUrl(result), attempts, nowIso(), generation.id)
      return { done: true }
    }
    if (['FAILED', 'CANCELLED'].includes(String(status.status || '').toUpperCase())) {
      await run(env, `UPDATE generations SET status = 'failed', provider_state = ?, error = ?, poll_attempts = ?, completed_at = ? WHERE id = ?`,
        providerState, String(status.error || status.detail || `provider_${providerState}`).slice(0, 500), attempts, nowIso(), generation.id)
      return { done: true }
    }
    if (attempts >= 180) {
      await run(env, `UPDATE generations SET status = 'failed', provider_state = 'timed_out', error = 'provider_timeout', poll_attempts = ?, completed_at = ? WHERE id = ?`, attempts, nowIso(), generation.id)
      return { done: true }
    }
    await run(env, `UPDATE generations SET provider_state = ?, poll_attempts = ?, last_provider_attempt_at = ?, last_provider_error = NULL WHERE id = ?`,
      providerState, attempts, nowIso(), generation.id)
    return { done: false, retrySeconds: 20 }
  } catch (error) {
    const attempts = generation.pollAttempts + 1
    await run(env, `UPDATE generations SET poll_attempts = ?, last_provider_error = ?, last_provider_attempt_at = ? WHERE id = ?`,
      attempts, providerDetail(error).slice(0, 500), nowIso(), generation.id)
    return { done: attempts >= 180, retrySeconds: 60 }
  }
}

async function processGeneration(env, id) {
  const context = await generationContext(env, id)
  if (!context || context.generation.status !== 'queued') return { done: true }
  const { generation } = context
  const age = Date.now() - Date.parse(generation.createdAt)
  const ceiling = maxQueuedMs(env, generation.kind)
  if (Number.isFinite(age) && age > ceiling) {
    await run(env, `UPDATE generations SET status = 'failed', provider_state = 'expired', error = ?, completed_at = ? WHERE id = ?`,
      `generation_expired_after_${Math.round(ceiling / 60000)}m`, nowIso(), generation.id)
    return { done: true }
  }
  if (!generation.providerStatusUrl) return dispatchGeneration(env, context)
  return reconcileGeneration(env, context)
}

async function enqueueGeneration(env, id, delaySeconds = 0) {
  if (!env.GENERATION_QUEUE) return false
  await env.GENERATION_QUEUE.send({ generationId: id }, delaySeconds > 0 ? { delaySeconds } : undefined)
  return true
}

async function route(request, env, ctx) {
  const origin = allowedOrigin(request, env)
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders(origin, {
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-max-age': '600',
    }) })
  }
  if (request.method === 'GET' && path === '/health') {
    return json({ status: 'ok', service: 'cresco-api', version: 2, runtime: 'cloudflare', persistence: ['d1', 'r2'] }, 200, origin)
  }
  const providerAssetMatch = path.match(/^\/v1\/provider-assets\/([^/]+)$/)
  if (providerAssetMatch && request.method === 'GET') return providerAssetResponse(request, env, decodeURIComponent(providerAssetMatch[1]))

  await ensureInitialized(env)

  if (request.method === 'POST' && path === '/v1/auth/login') {
    const body = await readJson(request)
    const email = String(body.email || '').trim().toLowerCase()
    if (await loginRateLimited(request, email, env)) throw new ApiError(429, 'rate_limit_exceeded')
    const user = userFromRow(await first(env, 'SELECT * FROM users WHERE workspace_id = ? AND email = ?', WORKSPACE_ID, email))
    if (!user || user.status !== 'active' || !(await verifyPassword(String(body.password || ''), user.passwordHash, env))) {
      await audit(env, null, 'auth.login_failed', email)
      throw new ApiError(401, 'invalid_credentials')
    }
    await audit(env, user, 'auth.login', user.id, { client: String(body.client || 'unknown') })
    return json({ token: await signToken(user, env), user: safeUser(user) }, 200, origin)
  }

  const user = await authenticate(request, env)
  if (!user) throw new ApiError(401, 'authentication_required')

  if (request.method === 'GET' && path === '/v1/me') return json({ user: safeUser(user) }, 200, origin)
  if (request.method === 'PATCH' && path === '/v1/me') {
    const body = await readJson(request)
    let name = user.name
    let preferences = user.preferences || {}
    let passwordHash = user.passwordHash
    let sessionVersion = user.sessionVersion
    const changed = []
    if (body.name !== undefined) {
      name = String(body.name).trim()
      if (name.length < 2 || name.length > 100) throw new ApiError(400, 'invalid_name')
      changed.push('name')
    }
    if (body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences)) {
      preferences = { ...preferences }
      for (const key of ['generationCompleted', 'weeklySummary', 'generationFailed']) {
        if (typeof body.preferences[key] === 'boolean') preferences[key] = body.preferences[key]
      }
      changed.push('preferences')
    }
    if (body.newPassword !== undefined) {
      if (!(await verifyPassword(String(body.currentPassword || ''), user.passwordHash, env))) throw new ApiError(400, 'current_password_incorrect')
      if (String(body.newPassword).length < 10) throw new ApiError(400, 'password_too_short')
      passwordHash = await hashPassword(String(body.newPassword), env)
      sessionVersion += 1
      changed.push('password')
    }
    if (!changed.length) throw new ApiError(400, 'no_profile_changes')
    await run(env, 'UPDATE users SET name = ?, preferences_json = ?, password_hash = ?, session_version = ? WHERE id = ?',
      name, JSON.stringify(preferences), passwordHash, sessionVersion, user.id)
    const updated = { ...user, name, preferences, passwordHash, sessionVersion }
    await audit(env, updated, 'profile.updated', user.id, { fields: changed })
    return json({ user: safeUser(updated), token: await signToken(updated, env) }, 200, origin)
  }

  if (request.method === 'GET' && path === '/v1/models') {
    const rows = await all(env, "SELECT * FROM models WHERE workspace_id = ? AND archived_at IS NULL AND status != 'disabled' ORDER BY created_at DESC", WORKSPACE_ID)
    return json({ models: await safeModels(env, rows) }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/uploads') {
    const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!['image/', 'video/', 'audio/'].some(prefix => contentType.startsWith(prefix))) throw new ApiError(415, 'unsupported_reference_type')
    const declared = Number(request.headers.get('content-length') || 0)
    if (declared > MAX_UPLOAD_BYTES) throw new ApiError(413, 'file_too_large')
    const contents = await request.arrayBuffer()
    if (!contents.byteLength) throw new ApiError(400, 'empty_file')
    if (contents.byteLength > MAX_UPLOAD_BYTES) throw new ApiError(413, 'file_too_large')
    const fileName = String(url.searchParams.get('name') || 'reference').trim().slice(0, 200)
    const id = crypto.randomUUID()
    const storageKey = `${WORKSPACE_ID}/${user.id}/${id}`
    await env.UPLOADS.put(storageKey, contents, { httpMetadata: { contentType } })
    try {
      await run(env, `INSERT INTO uploads
        (id, workspace_id, owner_id, owner_email, file_name, content_type, byte_size, storage_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, WORKSPACE_ID, user.id, user.email, fileName, contentType, contents.byteLength, storageKey, nowIso())
    } catch (error) {
      await env.UPLOADS.delete(storageKey)
      throw error
    }
    await audit(env, user, 'upload.created', id, { fileName, contentType, size: contents.byteLength })
    const upload = { id, ownerEmail: user.email, fileName, contentType, size: contents.byteLength, storageKey, createdAt: nowIso() }
    return json({ upload: safeUpload(upload) }, 201, origin)
  }

  const uploadMatch = path.match(/^\/v1\/uploads\/([^/]+)$/)
  if (uploadMatch && request.method === 'GET') {
    const upload = uploadFromRow(await first(env, 'SELECT * FROM uploads WHERE id = ? AND workspace_id = ?', decodeURIComponent(uploadMatch[1]), WORKSPACE_ID))
    if (!upload || (user.role !== 'admin' && upload.ownerEmail !== user.email)) throw new ApiError(404, 'upload_not_found')
    return json({ upload: safeUpload(upload) }, 200, origin)
  }

  if (request.method === 'GET' && path === '/v1/history') return json(await historyPage(env, user, url), 200, origin)
  if (request.method === 'GET' && path === '/v1/usage/summary') return json(await usageSummary(env), 200, origin)

  const generationMatch = path.match(/^\/v1\/generations\/([^/]+)$/)
  if (generationMatch && request.method === 'GET') {
    const generation = generationFromRow(await first(env, 'SELECT * FROM generations WHERE id = ? AND workspace_id = ?', decodeURIComponent(generationMatch[1]), WORKSPACE_ID))
    if (!generation || (user.role !== 'admin' && generation.userId !== user.id)) throw new ApiError(404, 'generation_not_found')
    await attachReferences(env, [generation])
    return json({ generation: safeGeneration(generation) }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/generations') {
    const body = await readJson(request)
    const prompt = String(body.prompt || '').trim()
    if (!body.modelId || !prompt) throw new ApiError(400, 'model_and_prompt_required')
    if (prompt.length > 20000) throw new ApiError(400, 'prompt_too_long')
    const model = modelFromRow(await first(env, "SELECT * FROM models WHERE id = ? AND workspace_id = ? AND archived_at IS NULL AND status != 'disabled'", String(body.modelId), WORKSPACE_ID))
    if (!model) throw new ApiError(400, 'model_and_prompt_required')
    const credential = await credentialFor(env, model.provider)
    if (!credential || !['fal.ai', 'byteplus'].includes(providerKey(model.provider)) || !model.endpoint) throw new ApiError(409, 'model_not_ready')
    const policy = await first(env, 'SELECT * FROM budget_policies WHERE workspace_id = ?', WORKSPACE_ID)
    const estimatedCost = Number(model.priceNanoUsd || 0)
    if (Number(policy?.per_generation_limit_nano_usd || 0) > 0 && estimatedCost > Number(policy.per_generation_limit_nano_usd)) {
      throw new ApiError(402, 'generation_limit_exceeded', { estimatedCostNanoUsd: estimatedCost, limitNanoUsd: Number(policy.per_generation_limit_nano_usd) })
    }
    const month = new Date()
    month.setUTCDate(1)
    month.setUTCHours(0, 0, 0, 0)
    const monthly = await first(env, `SELECT COALESCE(SUM(CASE WHEN status = 'queued' THEN estimated_cost_nano_usd ELSE cost_nano_usd END), 0) AS committed
      FROM generations WHERE workspace_id = ? AND created_at >= ?`, WORKSPACE_ID, month.toISOString())
    const monthlyLimit = Number(policy?.workspace_monthly_limit_nano_usd || 0)
    if (monthlyLimit > 0 && Number(monthly?.committed || 0) + estimatedCost > monthlyLimit) {
      throw new ApiError(402, 'workspace_budget_exceeded', { estimatedCostNanoUsd: estimatedCost, committedNanoUsd: Number(monthly?.committed || 0), limitNanoUsd: monthlyLimit })
    }
    const referenceIds = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.map(String))].slice(0, 5) : []
    if (referenceIds.length) {
      const placeholders = referenceIds.map(() => '?').join(',')
      const ownershipClause = user.role === 'admin' ? '' : ' AND owner_id = ?'
      const found = await all(env, `SELECT id FROM uploads WHERE workspace_id = ? AND id IN (${placeholders})${ownershipClause}`,
        WORKSPACE_ID, ...referenceIds, ...(user.role === 'admin' ? [] : [user.id]))
      if (found.length !== referenceIds.length) throw new ApiError(400, 'invalid_reference')
    }
    const id = crypto.randomUUID()
    const createdAt = nowIso()
    const title = String(body.title || prompt.slice(0, 64) || 'Untitled generation').trim().slice(0, 100)
    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options) ? body.options : {}
    const statements = [env.DB.prepare(`INSERT INTO generations
      (id, workspace_id, user_id, user_email, model_id, model_name, model_provider, title, kind, prompt, options_json, status, estimated_cost_nano_usd, cost_nano_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)`)
      .bind(id, WORKSPACE_ID, user.id, user.email, model.id, model.name, model.provider, title, model.kind, prompt, JSON.stringify(options), estimatedCost, createdAt)]
    for (const referenceId of referenceIds) statements.push(env.DB.prepare('INSERT INTO generation_references (generation_id, upload_id) VALUES (?, ?)').bind(id, referenceId))
    try {
      await env.DB.batch(statements)
    } catch (error) {
      const message = String(error?.message || '')
      if (message.includes('generation_limit_exceeded')) throw new ApiError(402, 'generation_limit_exceeded')
      if (message.includes('workspace_budget_exceeded')) throw new ApiError(402, 'workspace_budget_exceeded')
      throw error
    }
    await audit(env, user, 'generation.submitted', id, { modelId: model.id })
    const generation = { id, userId: user.id, userEmail: user.email, title, modelId: model.id, modelName: model.name, modelProvider: model.provider, kind: model.kind, prompt, options, status: 'queued', costNanoUsd: 0, createdAt, references: [] }
    if (referenceIds.length) await attachReferences(env, [generation])
    if (body.stream === true && model.kind === 'text' && providerKey(model.provider) === 'byteplus') {
      return streamTextGeneration(env, ctx, { generation, model, credential, origin })
    }
    const processing = await processGeneration(env, id)
    if (!processing.done) {
      ctx.waitUntil(enqueueGeneration(env, id, processing.retrySeconds || 20))
    }
    const current = generationFromRow(await first(env, 'SELECT * FROM generations WHERE id = ? AND workspace_id = ?', id, WORKSPACE_ID))
    await attachReferences(env, [current])
    return json({ generation: safeGeneration(current) }, current.status === 'complete' ? 201 : 202, origin)
  }

  if (user.role !== 'admin') throw new ApiError(403, 'admin_required')

  if (request.method === 'GET' && path === '/v1/admin/users') {
    const rows = await all(env, 'SELECT * FROM users WHERE workspace_id = ? ORDER BY created_at', WORKSPACE_ID)
    return json({ users: rows.map(userFromRow).map(safeUser) }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/admin/users') {
    const body = await readJson(request)
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!name || !email || !password) throw new ApiError(400, 'name_email_password_required')
    if (password.length < 10) throw new ApiError(400, 'password_too_short')
    if (await first(env, 'SELECT id FROM users WHERE workspace_id = ? AND email = ?', WORKSPACE_ID, email)) throw new ApiError(409, 'email_exists')
    const created = {
      id: crypto.randomUUID(), name, email, role: body.role === 'admin' ? 'admin' : 'member', status: body.status === 'pending' ? 'pending' : 'active',
      sessionVersion: 1, preferences: { generationCompleted: true, weeklySummary: true, generationFailed: true }, createdAt: nowIso(),
    }
    await run(env, `INSERT INTO users
      (id, workspace_id, name, email, password_hash, role, status, session_version, preferences_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, created.id, WORKSPACE_ID, created.name, created.email, await hashPassword(password, env), created.role, created.status, JSON.stringify(created.preferences), created.createdAt)
    await audit(env, user, 'user.created', created.id, { role: created.role, status: created.status })
    return json({ user: safeUser(created) }, 201, origin)
  }

  const userMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/)
  if (userMatch && request.method === 'PATCH') {
    const target = userFromRow(await first(env, 'SELECT * FROM users WHERE id = ? AND workspace_id = ?', decodeURIComponent(userMatch[1]), WORKSPACE_ID))
    if (!target) throw new ApiError(404, 'user_not_found')
    const body = await readJson(request)
    if (target.id === user.id && ((body.status && body.status !== 'active') || body.role === 'member')) throw new ApiError(400, 'cannot_remove_own_admin_access')
    if (target.role === 'admin' && body.status && body.status !== 'active') {
      const activeAdmins = await first(env, "SELECT COUNT(*) AS count FROM users WHERE workspace_id = ? AND role = 'admin' AND status = 'active'", WORKSPACE_ID)
      if (Number(activeAdmins?.count || 0) <= 1) throw new ApiError(400, 'last_active_admin_required')
    }
    const status = ['active', 'pending', 'suspended'].includes(body.status) ? body.status : target.status
    const role = ['member', 'admin'].includes(body.role) ? body.role : target.role
    let passwordHash = target.passwordHash
    let sessionVersion = target.sessionVersion
    if (body.password !== undefined) {
      if (String(body.password).length < 10) throw new ApiError(400, 'password_too_short')
      passwordHash = await hashPassword(String(body.password), env)
      sessionVersion += 1
    }
    await run(env, 'UPDATE users SET status = ?, role = ?, password_hash = ?, session_version = ? WHERE id = ?', status, role, passwordHash, sessionVersion, target.id)
    const updated = { ...target, status, role, passwordHash, sessionVersion }
    await audit(env, user, 'user.updated', target.id, { status, role, passwordReset: body.password !== undefined })
    return json({ user: safeUser(updated) }, 200, origin)
  }

  if (request.method === 'GET' && path === '/v1/admin/models') {
    const rows = await all(env, 'SELECT * FROM models WHERE workspace_id = ? AND archived_at IS NULL ORDER BY created_at DESC', WORKSPACE_ID)
    return json({ models: await safeModels(env, rows) }, 200, origin)
  }

  if (request.method === 'PATCH' && path === '/v1/admin/policies') {
    const body = await readJson(request)
    const workspaceMonthlyLimitNanoUsd = toNanoUsd(body.workspaceMonthlyLimitUsd)
    const perGenerationLimitNanoUsd = toNanoUsd(body.perGenerationLimitUsd)
    const warnAtPercent = Number(body.warnAtPercent)
    if (workspaceMonthlyLimitNanoUsd === null || perGenerationLimitNanoUsd === null || !Number.isFinite(warnAtPercent) || warnAtPercent < 1 || warnAtPercent > 100) throw new ApiError(400, 'invalid_budget_policy')
    const policy = { workspaceMonthlyLimitNanoUsd, perGenerationLimitNanoUsd, warnAtPercent: Math.round(warnAtPercent) }
    await run(env, `UPDATE budget_policies SET workspace_monthly_limit_nano_usd = ?, per_generation_limit_nano_usd = ?, warn_at_percent = ?, updated_at = ? WHERE workspace_id = ?`,
      policy.workspaceMonthlyLimitNanoUsd, policy.perGenerationLimitNanoUsd, policy.warnAtPercent, nowIso(), WORKSPACE_ID)
    await audit(env, user, 'budget.updated', 'workspace', policy)
    return json({ policy }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/admin/providers/credentials') {
    const body = await readJson(request)
    const provider = String(body.provider || '').trim()
    const apiKey = String(body.apiKey || '').trim()
    if (!provider || !apiKey) throw new ApiError(400, 'provider_and_api_key_required')
    const normalized = await storeCredential(env, provider, apiKey)
    await audit(env, user, 'provider.credential_updated', normalized)
    return json({ provider: normalized, configured: true }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/admin/models') {
    const body = await readJson(request)
    if (!body.name || !body.provider || !['text', 'image', 'video'].includes(body.kind)) throw new ApiError(400, 'invalid_model_record')
    const apiKey = String(body.apiKey || '').trim()
    if (apiKey) await storeCredential(env, body.provider, apiKey)
    const hasCredential = Boolean(await credentialFor(env, body.provider))
    const priceNanoUsd = toNanoUsd(body.priceUsd || 0)
    if (priceNanoUsd === null) throw new ApiError(400, 'invalid_model_price')
    if (body.thinkingMode !== undefined && !THINKING_MODES.includes(body.thinkingMode)) throw new ApiError(400, 'invalid_thinking_mode')
    if (body.textApi !== undefined && !TEXT_APIS.includes(body.textApi)) throw new ApiError(400, 'invalid_text_api')
    const created = {
      id: crypto.randomUUID(), name: String(body.name).trim().slice(0, 120), description: String(body.description || '').trim().slice(0, 500),
      provider: String(body.provider).trim().slice(0, 120), kind: body.kind, endpoint: String(body.endpoint || '').trim().slice(0, 300) || null,
      status: hasCredential ? (body.status === 'beta' ? 'beta' : 'active') : 'disabled', priceNanoUsd,
      thinkingMode: body.thinkingMode || 'disabled', textApi: body.textApi || 'chat_completions',
      createdAt: nowIso(), archivedAt: null,
    }
    await run(env, `INSERT INTO models
      (id, workspace_id, name, description, provider, kind, endpoint, status, price_nano_usd, thinking_mode, text_api, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, created.id, WORKSPACE_ID, created.name, created.description, created.provider, created.kind, created.endpoint, created.status, created.priceNanoUsd, created.thinkingMode, created.textApi, created.createdAt)
    await audit(env, user, 'model.created', created.id, { provider: created.provider, kind: created.kind, credentialUpdated: Boolean(apiKey) })
    return json({ model: (await safeModels(env, [{ ...created, price_nano_usd: priceNanoUsd, thinking_mode: created.thinkingMode, text_api: created.textApi, created_at: created.createdAt, archived_at: null }]))[0] }, 201, origin)
  }

  if (request.method === 'GET' && path === '/v1/admin/providers') {
    const providers = await all(env, 'SELECT provider_key, updated_at FROM provider_credentials WHERE workspace_id = ? ORDER BY provider_key', WORKSPACE_ID)
    return json({ providers: providers.map(item => ({ provider: item.provider_key, configured: true, updatedAt: item.updated_at })) }, 200, origin)
  }

  const modelMatch = path.match(/^\/v1\/admin\/models\/([^/]+)$/)
  if (modelMatch && request.method === 'PATCH') {
    const target = modelFromRow(await first(env, 'SELECT * FROM models WHERE id = ? AND workspace_id = ? AND archived_at IS NULL', decodeURIComponent(modelMatch[1]), WORKSPACE_ID))
    if (!target) throw new ApiError(404, 'model_not_found')
    const body = await readJson(request)
    if (body.kind !== undefined && !['text', 'image', 'video'].includes(body.kind)) throw new ApiError(400, 'invalid_model_kind')
    const status = ['active', 'beta', 'disabled'].includes(body.status) ? body.status : target.status
    const name = body.name !== undefined && String(body.name).trim() ? String(body.name).trim().slice(0, 120) : target.name
    const description = body.description !== undefined ? String(body.description).trim().slice(0, 500) : target.description
    const provider = body.provider !== undefined && String(body.provider).trim() ? String(body.provider).trim().slice(0, 120) : target.provider
    const kind = body.kind || target.kind
    const endpoint = body.endpoint !== undefined ? String(body.endpoint).trim().slice(0, 300) || null : target.endpoint
    let priceNanoUsd = target.priceNanoUsd
    if (body.priceUsd !== undefined) {
      priceNanoUsd = toNanoUsd(body.priceUsd)
      if (priceNanoUsd === null) throw new ApiError(400, 'invalid_model_price')
    }
    if (body.thinkingMode !== undefined && !THINKING_MODES.includes(body.thinkingMode)) throw new ApiError(400, 'invalid_thinking_mode')
    if (body.textApi !== undefined && !TEXT_APIS.includes(body.textApi)) throw new ApiError(400, 'invalid_text_api')
    const thinking = body.thinkingMode !== undefined ? body.thinkingMode : target.thinkingMode
    const api = body.textApi !== undefined ? body.textApi : target.textApi
    const apiKey = String(body.apiKey || '').trim()
    if (apiKey) await storeCredential(env, provider, apiKey)
    await run(env, 'UPDATE models SET name = ?, description = ?, provider = ?, kind = ?, endpoint = ?, status = ?, price_nano_usd = ?, thinking_mode = ?, text_api = ? WHERE id = ?',
      name, description, provider, kind, endpoint, status, priceNanoUsd, thinking, api, target.id)
    const updated = { ...target, name, description, provider, kind, endpoint, status, priceNanoUsd, thinkingMode: thinking, textApi: api }
    await audit(env, user, 'model.updated', target.id, { status, provider, kind, credentialUpdated: Boolean(apiKey) })
    return json({ model: (await safeModels(env, [{ ...updated, price_nano_usd: priceNanoUsd, thinking_mode: thinking, text_api: api, created_at: updated.createdAt, archived_at: null }]))[0] }, 200, origin)
  }

  if (modelMatch && request.method === 'DELETE') {
    const target = modelFromRow(await first(env, 'SELECT * FROM models WHERE id = ? AND workspace_id = ? AND archived_at IS NULL', decodeURIComponent(modelMatch[1]), WORKSPACE_ID))
    if (!target) throw new ApiError(404, 'model_not_found')
    await run(env, "UPDATE models SET status = 'disabled', archived_at = ? WHERE id = ?", nowIso(), target.id)
    await audit(env, user, 'model.archived', target.id, { name: target.name })
    return json({ removed: true }, 200, origin)
  }

  if (request.method === 'GET' && path === '/v1/admin/audit') {
    const limit = pageLimit(url)
    const cursor = url.searchParams.get('cursor')
    const cursorRow = cursor ? await first(env, 'SELECT id, created_at FROM audit_events WHERE id = ? AND workspace_id = ?', cursor, WORKSPACE_ID) : null
    const bindings = [WORKSPACE_ID]
    let cursorClause = ''
    if (cursorRow) {
      cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))'
      bindings.push(cursorRow.created_at, cursorRow.created_at, cursorRow.id)
    }
    bindings.push(limit + 1)
    const rows = await all(env, `SELECT * FROM audit_events WHERE workspace_id = ?${cursorClause} ORDER BY created_at DESC, id DESC LIMIT ?`, ...bindings)
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(item => ({
      id: item.id, actorId: item.actor_id, actorEmail: item.actor_email, action: item.action, target: item.target,
      metadata: parseJson(item.metadata_json, {}), createdAt: item.created_at,
    }))
    return json({ events: page, nextCursor: hasMore ? page.at(-1)?.id || null : null }, 200, origin)
  }

  if (request.method === 'GET' && path === '/v1/admin/balances') {
    const rows = await all(env, 'SELECT provider, amount_nano_usd, source, synced_at FROM provider_balances WHERE workspace_id = ? ORDER BY provider', WORKSPACE_ID)
    return json({ balances: rows.map(item => ({ provider: item.provider, amountNanoUsd: Number(item.amount_nano_usd || 0), source: item.source, syncedAt: item.synced_at })) }, 200, origin)
  }

  if (request.method === 'POST' && path === '/v1/admin/reconcile') {
    const pending = await all(env, "SELECT id FROM generations WHERE workspace_id = ? AND status = 'queued' ORDER BY created_at LIMIT 50", WORKSPACE_ID)
    ctx.waitUntil(Promise.all(pending.map(item => enqueueGeneration(env, item.id).then(queued => queued ? undefined : processGeneration(env, item.id)))))
    let providerSync
    try {
      providerSync = await syncFalAccount(env)
      await audit(env, user, 'provider.synced', 'fal.ai', providerSync)
    } catch (error) {
      providerSync = { provider: 'fal.ai', configured: true, synced: false, error: error instanceof Error ? error.message.slice(0, 300) : 'provider_sync_failed' }
      await audit(env, user, 'provider.sync_failed', 'fal.ai', { error: providerSync.error })
    }
    return json({ reconciled: true, queued: pending.length, providerSync }, 200, origin)
  }

  throw new ApiError(404, 'not_found')
}

async function fetchHandler(request, env, ctx) {
  const origin = allowedOrigin(request, env)
  try {
    return await route(request, env, ctx)
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, ...error.details }, error.status, origin)
    console.error(error)
    const message = String(error?.message || '')
    if (message.includes('no such table')) return json({ error: 'database_not_migrated' }, 503, origin)
    return json({ error: 'internal_error' }, 500, origin)
  }
}

async function queueHandler(batch, env) {
  for (const message of batch.messages) {
    try {
      const id = String(message.body?.generationId || '')
      if (!id) {
        message.ack()
        continue
      }
      const result = await processGeneration(env, id)
      if (!result.done) await enqueueGeneration(env, id, result.retrySeconds || 20)
      message.ack()
    } catch (error) {
      console.error(error)
      message.retry({ delaySeconds: 30 })
    }
  }
}

async function scheduledHandler(_controller, env, ctx) {
  const work = async () => {
    const pending = await all(env, `SELECT id, created_at, last_provider_attempt_at FROM generations
      WHERE workspace_id = ? AND status = 'queued' ORDER BY created_at LIMIT 50`, WORKSPACE_ID)
    // Anything the queue has not advanced recently is processed here directly, so a
    // queue that is unavailable, unbound or whose consumer is failing cannot strand
    // a job. Fresh rows still take the fast queue path.
    const now = Date.now()
    const stale = pending.filter(item => now - Date.parse(item.last_provider_attempt_at || item.created_at) > STALE_QUEUED_MS)
    const fresh = pending.filter(item => !stale.includes(item))
    if (env.GENERATION_QUEUE && fresh.length) {
      await env.GENERATION_QUEUE.sendBatch(fresh.map(item => ({ body: { generationId: item.id } })))
    } else {
      await Promise.all(fresh.map(item => processGeneration(env, item.id)))
    }
    for (const item of stale) {
      await processGeneration(env, item.id).catch(error => console.error('stale_generation_failed', item.id, error))
    }
    await run(env, 'DELETE FROM login_rate_limits WHERE window_started_at < ?', Date.now() - 24 * 60 * 60 * 1000)
    const lastFalSync = await first(env, "SELECT synced_at FROM provider_balances WHERE workspace_id = ? AND provider = 'fal.ai'", WORKSPACE_ID)
    if (!lastFalSync || Date.now() - Date.parse(lastFalSync.synced_at) >= 60 * 60 * 1000) {
      await syncFalAccount(env).catch(error => console.error('fal_account_sync_failed', error))
    }
  }
  ctx.waitUntil(work())
}

export default {
  fetch: fetchHandler,
  queue: queueHandler,
  scheduled: scheduledHandler,
}

export const __test = {
  bytesToBase64Url,
  base64UrlToBytes,
  decryptSecret,
  encryptSecret,
  hashPassword,
  isTimeoutError,
  providerFailure,
  providerOutputText,
  providerKey,
  providerTimeoutMs,
  maxQueuedMs,
  resultUrl,
  streamTextDelta,
  textRequestBody,
  textRequestPath,
  signToken,
  toNanoUsd,
  verifyPassword,
  verifyToken,
}
