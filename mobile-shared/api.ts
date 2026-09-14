import * as SecureStore from 'expo-secure-store'

declare const process: { env: Record<string, string | undefined> }
declare const __DEV__: boolean

const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://10.0.2.2:8787' : 'https://cresco-api.thesaintray5522.workers.dev')
const SESSION_KEY = 'cresco_mobile_session'
let sessionToken = ''

export async function clearMobileSession() {
  sessionToken = ''
  await SecureStore.deleteItemAsync(SESSION_KEY)
}

export type MobileSession = {
  token: string
  user: { id: string; name: string; email: string; role: 'admin' | 'member'; status: string; preferences?: { generationCompleted?: boolean; weeklySummary?: boolean; generationFailed?: boolean } }
}

export type ApiUser = MobileSession['user'] & { createdAt: string }
export type ThinkingMode = 'disabled' | 'enabled' | 'auto'
export type TextApi = 'chat_completions' | 'responses'
export type ApiModel = { id: string; name: string; description?: string; provider: string; kind: 'text' | 'image' | 'video'; status: 'active' | 'beta' | 'disabled'; endpoint?: string | null; priceNanoUsd?: number; thinkingMode?: ThinkingMode; textApi?: TextApi; contextTurns?: number; createdAt: string; credentialConfigured?: boolean; adapterConfigured?: boolean; executionReady?: boolean }
export type ApiUpload = { id: string; ownerEmail: string; fileName: string; contentType: string; size: number; createdAt: string }
export type ApiGeneration = { id: string; userEmail: string; title: string; modelId: string; modelName?: string; modelProvider?: string; kind: 'text' | 'image' | 'video'; prompt: string; status: 'complete' | 'failed' | 'queued'; costNanoUsd: number; costSource?: 'catalog_estimate' | 'pending_reconciliation' | 'provider'; resultUrl?: string | null; outputText?: string | null; error?: string | null; providerLatencyMs?: number | null; queuedForMs?: number | null; sessionId?: string | null; completedAt?: string | null; references?: ApiUpload[]; createdAt: string }
export type ApiBalance = { provider: string; amountNanoUsd: number; source: 'provider' | 'ledger'; syncedAt: string }
export type ApiProvider = { provider: string; configured: boolean; updatedAt: string }
export type BudgetPolicy = { workspaceMonthlyLimitNanoUsd: number; perGenerationLimitNanoUsd: number; warnAtPercent: number }
export type ProviderUsage = { periodStart: string; spendNanoUsd: number; syncedAt: string; byEndpoint: Array<{ provider: string; endpointId: string; quantity: number; spendNanoUsd: number; currency: string }> }
export type UsageSummary = { spendNanoUsd: number; calls: number; byModel: Array<{ modelId: string; name: string; provider: string; calls: number; spendNanoUsd: number }>; byMember?: Array<{ email: string; calls: number; spendNanoUsd: number }>; monthlySpendNanoUsd?: number; monthlyCommittedNanoUsd?: number; budget?: BudgetPolicy; balances: ApiBalance[]; providerUsage?: ProviderUsage | null }
export type AuditEvent = { id: string; actorId: string | null; actorEmail: string; action: string; target: string; metadata: Record<string, unknown>; createdAt: string }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...init.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      await clearMobileSession()
      throw new Error('Your session expired. Please log in again.')
    }
    const messages: Record<string, string> = {
      password_too_short: 'Use at least 10 characters for the password.',
      email_exists: 'That email already has an account.',
      last_active_admin_required: 'At least one active administrator is required.',
      cannot_remove_own_admin_access: 'You cannot remove your own administrator access.',
      model_not_ready: 'This model still needs an administrator to connect its key and adapter.',
      generation_limit_exceeded: 'This request is above the administrator’s per-generation limit.',
      workspace_budget_exceeded: 'The monthly workspace budget does not have enough room for this request.',
      invalid_budget_policy: 'Enter valid budget amounts and a warning threshold from 1 to 100.',
    }
    throw new Error(messages[data.error] || data.message || data.error || 'Could not complete this request.')
  }
  return data as T
}

export async function login(email: string, password: string, client: 'team-mobile' | 'admin-mobile'): Promise<MobileSession> {
  const response = await fetch(API_URL + '/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, client }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) throw new Error('The email or password is incorrect.')
    throw new Error(data.message || 'Could not reach the Cresco workspace service.')
  }
  sessionToken = data.token
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(data), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK })
  return data
}

export async function restoreMobileSession(): Promise<MobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY)
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as MobileSession
    if (!session.token || !session.user?.id) throw new Error('invalid_session')
    sessionToken = session.token
    return session
  } catch {
    await clearMobileSession()
    return null
  }
}

export async function getMemberWorkspace() {
  const [models, history, usage] = await Promise.all([
    request<{ models: ApiModel[] }>('/v1/models'),
    request<{ generations: ApiGeneration[] }>('/v1/history'),
    request<UsageSummary>('/v1/usage/summary'),
  ])
  return { models: models.models, generations: history.generations, usage }
}

export type ApiSession = { id: string; modelId: string; title: string; createdAt: string; updatedAt: string; generationCount?: number }

export async function submitGeneration(modelId: string, prompt: string, options: Record<string, string> = {}, referenceIds: string[] = [], sessionId?: string) {
  return request<{ generation: ApiGeneration }>('/v1/generations', { method: 'POST', body: JSON.stringify({ modelId, prompt, options, referenceIds, sessionId }) })
}

export async function listSessions(modelId?: string) {
  return request<{ sessions: ApiSession[] }>(`/v1/sessions${modelId ? `?modelId=${encodeURIComponent(modelId)}` : ''}`)
}

export async function getSession(id: string) {
  return request<{ session: ApiSession; generations: ApiGeneration[] }>(`/v1/sessions/${encodeURIComponent(id)}`)
}

export async function renameSession(id: string, title: string) {
  return request<{ session: ApiSession }>(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) })
}

export async function archiveSession(id: string) {
  return request<{ archived: boolean }>(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function uploadMobileReference(input: { uri: string; name: string; mimeType?: string | null }) {
  const source = await fetch(input.uri)
  const body = await source.blob()
  return request<{ upload: ApiUpload }>(`/v1/uploads?name=${encodeURIComponent(input.name)}`, {
    method: 'POST',
    headers: { 'content-type': input.mimeType || body.type || 'application/octet-stream' },
    body,
  })
}

export async function getGeneration(id: string) {
  return request<{ generation: ApiGeneration }>(`/v1/generations/${encodeURIComponent(id)}`)
}

export async function getAdminWorkspace() {
  const [users, models, usage, audit, balances, history, providers] = await Promise.all([
    request<{ users: ApiUser[] }>('/v1/admin/users'),
    request<{ models: ApiModel[] }>('/v1/admin/models'),
    request<UsageSummary>('/v1/usage/summary'),
    request<{ events: AuditEvent[] }>('/v1/admin/audit'),
    request<{ balances: ApiBalance[] }>('/v1/admin/balances'),
    request<{ generations: ApiGeneration[] }>('/v1/history'),
    request<{ providers: ApiProvider[] }>('/v1/admin/providers'),
  ])
  return { users: users.users, models: models.models, usage, events: audit.events, balances: balances.balances, generations: history.generations, providers: providers.providers }
}

export async function updateUser(id: string, changes: { status?: 'active' | 'pending' | 'suspended'; role?: 'admin' | 'member'; password?: string }) {
  return request<{ user: ApiUser }>(`/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) })
}

export async function createUser(input: { name: string; email: string; password: string; role?: 'admin' | 'member'; status?: 'active' | 'pending' }) {
  return request<{ user: ApiUser }>('/v1/admin/users', { method: 'POST', body: JSON.stringify(input) })
}

export async function createModel(input: { name: string; description?: string; provider: string; kind: 'text' | 'image' | 'video'; endpoint?: string; status?: 'active' | 'beta'; apiKey?: string; priceUsd?: number; thinkingMode?: ThinkingMode; textApi?: TextApi; contextTurns?: number }) {
  return request<{ model: ApiModel }>('/v1/admin/models', { method: 'POST', body: JSON.stringify(input) })
}

export async function updateModel(id: string, changes: { name?: string; description?: string; provider?: string; kind?: 'text' | 'image' | 'video'; endpoint?: string; priceUsd?: number; apiKey?: string; status?: 'active' | 'beta' | 'disabled'; thinkingMode?: ThinkingMode; textApi?: TextApi; contextTurns?: number }) {
  return request<{ model: ApiModel }>(`/v1/admin/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) })
}

export async function setProviderCredential(provider: string, apiKey: string) {
  return request<{ provider: string; configured: boolean }>('/v1/admin/providers/credentials', { method: 'POST', body: JSON.stringify({ provider, apiKey }) })
}

export async function updateBudgetPolicy(input: { workspaceMonthlyLimitUsd: number; perGenerationLimitUsd: number; warnAtPercent: number }) {
  return request<{ policy: BudgetPolicy }>('/v1/admin/policies', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function reconcileProviderData() {
  const result = await request<{ reconciled: boolean; queued?: number; providerSync: { provider: string; configured: boolean; synced: boolean; error?: string; balanceNanoUsd?: number; reconciledCosts?: number } }>('/v1/admin/reconcile', { method: 'POST' })
  if (result.providerSync.configured && !result.providerSync.synced) throw new Error(result.providerSync.error || 'Could not sync provider billing data.')
  return result
}

export async function deleteModel(id: string) {
  return request<{ removed: boolean }>(`/v1/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
