import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { archiveSession, getWorkspaceData, listSessions, renameSession, restoreSession, type ApiBalance, type ApiGeneration, type ApiModel, type ApiSession, type SessionUser, type UsageSummary } from '../api'

export type Kind = 'text' | 'image' | 'video'
export type ModelStatus = 'ready' | 'beta' | 'setup'

export type ModelView = ApiModel & {
  kind: Kind
  state: ModelStatus
  blurb: string
  calls: number
  spendNanoUsd: number
}

type WorkspaceValue = {
  user: SessionUser
  setUser: (user: SessionUser) => void
  models: ModelView[]
  generations: ApiGeneration[]
  usage: UsageSummary | null
  balances: ApiBalance[]
  loading: boolean
  refresh: (quiet?: boolean) => Promise<void>
  addGeneration: (generation: ApiGeneration) => void
  sessions: ApiSession[]
  refreshSessions: () => Promise<void>
  upsertSession: (session: ApiSession) => void
  rename: (id: string, title: string) => Promise<void>
  archive: (id: string) => Promise<void>
  toast: (message: string) => void
  signOut: () => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

const defaultBlurb: Record<Kind, string> = {
  text: 'Write, reason over and reshape text.',
  image: 'Generate and edit still images from a prompt.',
  video: 'Generate short video from a prompt or reference.',
}

export function toModelView(model: ApiModel, usage?: { calls: number; spendNanoUsd: number }): ModelView {
  const kind = model.kind as Kind
  return {
    ...model,
    kind,
    state: !model.executionReady ? 'setup' : model.status === 'beta' ? 'beta' : 'ready',
    blurb: model.description?.trim() || defaultBlurb[kind] || '',
    calls: usage?.calls || 0,
    spendNanoUsd: Number(usage?.spendNanoUsd || 0),
  }
}

export function WorkspaceProvider({
  user, setUser, onToast, signOut, children,
}: {
  user: SessionUser
  setUser: (user: SessionUser) => void
  onToast: (message: string) => void
  signOut: () => void
  children: ReactNode
}) {
  const [models, setModels] = useState<ModelView[]>([])
  const [generations, setGenerations] = useState<ApiGeneration[]>([])
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [balances, setBalances] = useState<ApiBalance[]>([])
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (quiet = false) => {
    try {
      const data = await getWorkspaceData()
      const usageById = new Map(data.usage.byModel.map(item => [item.modelId, item]))
      setModels(data.models.map(model => toModelView(model, usageById.get(model.id))))
      setGenerations(data.generations)
      setUsage(data.usage)
      setBalances(data.usage.balances)
    } catch (reason) {
      if (!restoreSession()) signOut()
      else if (!quiet) onToast(reason instanceof Error ? reason.message : 'Workspace data is temporarily unavailable.')
    } finally {
      setLoading(false)
    }
  }, [onToast, signOut])

  const refreshSessions = useCallback(async () => {
    try {
      setSessions((await listSessions()).sessions)
    } catch {
      /* the thread list is not worth interrupting the workspace for */
    }
  }, [])

  const upsertSession = useCallback((session: ApiSession) => {
    setSessions(items => [session, ...items.filter(item => item.id !== session.id)])
  }, [])

  const rename = useCallback(async (id: string, title: string) => {
    const updated = (await renameSession(id, title)).session
    setSessions(items => items.map(item => (item.id === id ? { ...item, ...updated } : item)))
  }, [])

  const archive = useCallback(async (id: string) => {
    await archiveSession(id)
    setSessions(items => items.filter(item => item.id !== id))
  }, [])

  useEffect(() => { void refresh(); void refreshSessions() }, [refresh, refreshSessions])

  // Only poll while something is actually in flight; streamed text needs no poll.
  const waiting = generations.some(item => item.status === 'queued')
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void refresh(true), 4000)
    return () => window.clearInterval(timer)
  }, [waiting, refresh])

  const addGeneration = useCallback((generation: ApiGeneration) => {
    setGenerations(items => [generation, ...items.filter(item => item.id !== generation.id)])
  }, [])

  const value = useMemo(
    () => ({ user, setUser, models, generations, usage, balances, loading, refresh, addGeneration, sessions, refreshSessions, upsertSession, rename, archive, toast: onToast, signOut }),
    [user, setUser, models, generations, usage, balances, loading, refresh, addGeneration, sessions, refreshSessions, upsertSession, rename, archive, onToast, signOut],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}

export type Theme = 'system' | 'light' | 'dark'

export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem('cresco_theme', theme)
  } catch {
    /* private browsing */
  }
}

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem('cresco_theme')
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    /* private browsing */
  }
  return 'system'
}
