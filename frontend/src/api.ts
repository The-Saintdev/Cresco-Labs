const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
  status: string
  preferences?: {
    generationCompleted?: boolean
    weeklySummary?: boolean
    generationFailed?: boolean
  }
}

export type ApiModel = {
  id: string
  name: string
  description?: string
  provider: string
  kind: 'text' | 'image' | 'video'
  status: 'active' | 'beta' | 'disabled'
  endpoint?: string | null
  priceNanoUsd?: number
  thinkingMode?: 'disabled' | 'enabled' | 'auto'
  textApi?: 'chat_completions' | 'responses'
  credentialConfigured?: boolean
  adapterConfigured?: boolean
  executionReady?: boolean
  createdAt: string
}

export type ApiGeneration = {
  id: string
  userEmail: string
  title: string
  modelId: string
  modelName?: string
  modelProvider?: string
  kind: 'text' | 'image' | 'video'
  prompt: string
  status: 'complete' | 'failed' | 'queued'
  costNanoUsd: number
  costSource?: 'catalog_estimate' | 'pending_reconciliation' | 'provider'
  resultUrl?: string | null
  outputText?: string | null
  error?: string | null
  providerLatencyMs?: number | null
  completedAt?: string | null
  references?: ApiUpload[]
  createdAt: string
}

export type ApiUpload = {
  id: string
  ownerEmail: string
  fileName: string
  contentType: string
  size: number
  createdAt: string
}

export type ApiBalance = {
  provider: string
  amountNanoUsd: number
  source: 'provider' | 'ledger'
  syncedAt: string
}

export type ProviderUsage = {
  periodStart: string
  spendNanoUsd: number
  syncedAt: string
  byEndpoint: Array<{ provider: string; endpointId: string; quantity: number; spendNanoUsd: number; currency: string }>
}

export type UsageSummary = {
  spendNanoUsd: number
  calls: number
  byModel: Array<{ modelId: string; name: string; provider: string; calls: number; spendNanoUsd: number }>
  byMember?: Array<{ email: string; calls: number; spendNanoUsd: number }>
  monthlySpendNanoUsd?: number
  monthlyCommittedNanoUsd?: number
  budget?: { workspaceMonthlyLimitNanoUsd: number; perGenerationLimitNanoUsd: number; warnAtPercent: number }
  balances: ApiBalance[]
  providerUsage?: ProviderUsage | null
}

type LoginResponse = {
  token: string
  user: SessionUser
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('cresco_token')
  const response = await fetch(API_URL + path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearSession()
    throw new Error('Your session has expired. Please log in again.')
  }
  if (!response.ok) {
    const messages: Record<string, string> = {
      current_password_incorrect: 'Your current password is incorrect.',
      password_too_short: 'Use at least 10 characters for the password.',
      file_too_large: 'Reference files must be 25 MB or smaller.',
      unsupported_reference_type: 'Choose an image, video, or audio reference file.',
      invalid_reference: 'One of the attached references is no longer available.',
      model_not_ready: 'This model still needs an administrator to connect its key and adapter.',
      generation_limit_exceeded: 'This request is above the administrator’s per-generation limit.',
      workspace_budget_exceeded: 'The monthly workspace budget does not have enough room for this request.',
    }
    throw new Error(messages[data.error] || data.message || data.error || 'The workspace service could not complete this request.')
  }
  return data as T
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(API_URL + '/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, client: 'member-web' }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) throw new Error('The email or password is incorrect.')
    throw new Error(data.message || 'Cresco could not reach the workspace service.')
  }
  sessionStorage.setItem('cresco_token', data.token)
  sessionStorage.setItem('cresco_user', JSON.stringify(data.user))
  return data
}

export function restoreSession(): SessionUser | null {
  const raw = sessionStorage.getItem('cresco_user')
  if (!raw || !sessionStorage.getItem('cresco_token')) return null
  try {
    return JSON.parse(raw)
  } catch {
    clearSession()
    return null
  }
}

export function clearSession() {
  sessionStorage.removeItem('cresco_token')
  sessionStorage.removeItem('cresco_user')
}

export async function updateMe(changes: { name?: string; preferences?: SessionUser['preferences']; currentPassword?: string; newPassword?: string }) {
  const data = await request<{ user: SessionUser; token: string }>('/v1/me', { method: 'PATCH', body: JSON.stringify(changes) })
  sessionStorage.setItem('cresco_token', data.token)
  sessionStorage.setItem('cresco_user', JSON.stringify(data.user))
  return data
}

export async function getWorkspaceData() {
  const [models, history, usage] = await Promise.all([
    request<{ models: ApiModel[] }>('/v1/models'),
    request<{ generations: ApiGeneration[] }>('/v1/history'),
    request<UsageSummary>('/v1/usage/summary'),
  ])
  return { models: models.models, generations: history.generations, usage }
}

export async function submitGeneration(modelId: string, prompt: string, options: Record<string, string> = {}, referenceIds: string[] = []) {
  return request<{ generation: ApiGeneration }>('/v1/generations', {
    method: 'POST',
    body: JSON.stringify({ modelId, prompt, options, referenceIds }),
  })
}

type GenerationStreamHandlers = {
  onMeta?: (generation: ApiGeneration) => void
  onDelta?: (text: string) => void
}

// Text models stream so the member sees output at first token instead of waiting
// for the whole completion. Resolves with the finalised generation record.
export async function streamGeneration(
  modelId: string,
  prompt: string,
  options: Record<string, string> = {},
  referenceIds: string[] = [],
  handlers: GenerationStreamHandlers = {},
): Promise<ApiGeneration> {
  const token = sessionStorage.getItem('cresco_token')
  const response = await fetch(API_URL + '/v1/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ modelId, prompt, options, referenceIds, stream: true }),
  })
  if (response.status === 401) {
    clearSession()
    throw new Error('Your session has expired. Please log in again.')
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw new Error(generationErrorMessage(String(data.error || 'generation_failed')))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let final: ApiGeneration | null = null
  let failure = ''

  const handleFrame = (name: string, payload: string) => {
    if (!payload) return
    let data: any
    try {
      data = JSON.parse(payload)
    } catch {
      return
    }
    if (name === 'meta' && data.generation) handlers.onMeta?.(data.generation)
    else if (name === 'delta' && typeof data.text === 'string') handlers.onDelta?.(data.text)
    else if (name === 'done' && data.generation) final = data.generation
    else if (name === 'error') failure = String(data.error || 'generation_failed')
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) handleFrame(event, line.slice(5).trim())
      else if (!line) event = ''
    }
  }

  if (failure) throw new Error(generationErrorMessage(failure))
  if (!final) throw new Error('The model connection closed before it finished responding.')
  return final
}

export function generationErrorMessage(code: string): string {
  const timeout = code.match(/^provider_timeout_after_(\d+)s$/)
  if (timeout) return `The model did not respond within ${timeout[1]} seconds. Try a shorter prompt, or ask an admin to raise the text timeout.`
  const messages: Record<string, string> = {
    provider_empty_response: 'The model returned an empty response.',
    provider_credential_required: 'This model has no provider key configured yet.',
    provider_adapter_required: 'This provider is not supported by the backend yet.',
    model_not_ready: 'This model is missing an endpoint or a provider key.',
    generation_limit_exceeded: 'This request costs more than the per-generation limit.',
    workspace_budget_exceeded: 'The workspace monthly budget has been reached.',
  }
  return messages[code] || code
}

export async function uploadReference(file: File) {
  return request<{ upload: ApiUpload }>(`/v1/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
}

export async function getGeneration(id: string) {
  return request<{ generation: ApiGeneration }>(`/v1/generations/${encodeURIComponent(id)}`)
}
