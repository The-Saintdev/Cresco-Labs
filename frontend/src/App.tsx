import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight, Bell, Bot, Check, ChevronDown, CircleHelp, Clock3, Download, Eye, EyeOff,
  Film, Gauge, Image as ImageIcon, LayoutGrid, LockKeyhole, Menu, MessageSquare,
  MoreHorizontal, Plus, Search, Settings, ShieldCheck, SlidersHorizontal,
  Sparkles, Upload, Users, WandSparkles, X,
} from 'lucide-react'
import { clearSession, getGeneration, getWorkspaceData, login as apiLogin, restoreSession, submitGeneration, updateMe, uploadReference, type ApiBalance, type ApiGeneration, type ApiUpload, type SessionUser, type UsageSummary } from './api'

type View = 'home' | 'history' | 'usage' | 'settings'
type ModelKind = 'Text' | 'Image' | 'Video'
type ModelColor = 'coral' | 'lilac' | 'blue' | 'sun' | 'sage'
type Model = {
  id: string
  name: string
  provider: string
  description: string
  kind: ModelKind
  color: ModelColor
  icon: typeof Bot
  status: 'Ready' | 'Beta' | 'Setup'
  spend: number
  calls: number
  estimate: string
}
type Activity = {
  id: string
  title: string
  model: string
  date: string
  kind: ModelKind
  color: ModelColor
  cost: string
  status: 'Complete' | 'Failed' | 'Processing'
  prompt: string
  resultUrl?: string | null
  outputText?: string | null
  createdAt: string
}

const modelFixtures: Model[] = [
  { id: 'gpt', name: 'GPT-5', provider: 'OpenAI', description: 'Draft, reason, analyze and turn ideas into clear outputs.', kind: 'Text', color: 'coral', icon: MessageSquare, status: 'Ready', spend: 18.42, calls: 542, estimate: '$0.02' },
  { id: 'claude', name: 'Claude Sonnet', provider: 'Anthropic', description: 'Thoughtful writing, research and long-context collaboration.', kind: 'Text', color: 'lilac', icon: WandSparkles, status: 'Ready', spend: 12.08, calls: 318, estimate: '$0.03' },
  { id: 'veo', name: 'Veo 3', provider: 'Google', description: 'Create polished video concepts from a simple prompt.', kind: 'Video', color: 'blue', icon: Film, status: 'Ready', spend: 46.8, calls: 76, estimate: '$0.62' },
  { id: 'seedance', name: 'Seedance 2.0', provider: 'fal.ai · ByteDance', description: 'Cinematic video with native audio and multimodal references.', kind: 'Video', color: 'sun', icon: Sparkles, status: 'Ready', spend: 9.64, calls: 348, estimate: '$3.03' },
  { id: 'imagen', name: 'Imagen 4', provider: 'Google', description: 'Generate polished visual concepts, campaigns and image edits.', kind: 'Image', color: 'sage', icon: ImageIcon, status: 'Beta', spend: 4, calls: 45, estimate: '$0.08' },
]

const navItems = [
  { id: 'home' as View, label: 'Home', icon: LayoutGrid },
  { id: 'history' as View, label: 'History', icon: Clock3 },
  { id: 'usage' as View, label: 'Usage', icon: Gauge },
  { id: 'settings' as View, label: 'Settings', icon: Settings },
]

const cx = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
const downloadResult = async (url: string, id: string, kind: ModelKind) => {
  const extension = new URL(url).pathname.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 5) || (kind === 'Video' ? 'mp4' : 'png')
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('download_failed')
    const objectUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `cresco-${id}.${extension}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(() => restoreSession())
  const [models, setModels] = useState<Model[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [balances, setBalances] = useState<ApiBalance[]>([])
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [view, setView] = useState<View>('home')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760)
  const [activeModel, setActiveModel] = useState<Model | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [toast, setToast] = useState('')

  const refreshWorkspace = useCallback(async (quiet = false) => {
    try {
      const data = await getWorkspaceData()
      const usageById = new Map(data.usage.byModel.map(item => [item.modelId, item]))
      const colors: ModelColor[] = ['coral', 'lilac', 'blue', 'sun', 'sage']
      const liveModels = data.models.map((item, index): Model => {
        const fixture = modelFixtures.find(model => model.id === item.id || model.name === item.name)
        const usage = usageById.get(item.id)
        const kind = (item.kind[0].toUpperCase() + item.kind.slice(1)) as ModelKind
        return {
          id: item.id,
          name: item.name,
          provider: item.provider,
          description: item.description || fixture?.description || `${kind} model connected and approved for this workspace.`,
          kind,
          color: fixture?.color || colors[index % colors.length],
          icon: fixture?.icon || (kind === 'Video' ? Film : kind === 'Image' ? ImageIcon : MessageSquare),
          status: !item.executionReady ? 'Setup' : item.status === 'beta' ? 'Beta' : 'Ready',
          spend: Number(usage?.spendNanoUsd || 0) / 1_000_000_000,
          calls: usage?.calls || 0,
          estimate: item.priceNanoUsd ? money(item.priceNanoUsd / 1_000_000_000) : 'Tracked after run',
        }
      })
      const modelById = new Map(liveModels.map(model => [model.id, model]))
      const liveActivity = data.generations.map(item => {
        const model = modelById.get(item.modelId)
        const kind = (item.kind[0].toUpperCase() + item.kind.slice(1)) as ModelKind
        return {
          id: item.id,
          title: item.title,
          model: model?.name || item.modelName || item.modelId,
          date: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)),
          kind,
          color: model?.color || 'sage',
          cost: money(Number(item.costNanoUsd || 0) / 1_000_000_000),
          status: item.status === 'failed' ? 'Failed' : item.status === 'queued' ? 'Processing' : 'Complete',
          prompt: item.prompt,
          resultUrl: item.resultUrl,
          outputText: item.outputText,
          createdAt: item.createdAt,
        } satisfies Activity
      })
      setModels(liveModels)
      setActivity(liveActivity)
      setBalances(data.usage.balances)
      setUsageSummary(data.usage)
    } catch (reason) {
      if (!restoreSession()) setUser(null)
      else if (!quiet) setToast(reason instanceof Error ? reason.message : 'Live workspace data is temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void refreshWorkspace()
  }, [user, refreshWorkspace])

  const hasProcessingWork = activity.some(item => item.status === 'Processing')
  useEffect(() => {
    if (!user || !hasProcessingWork) return
    const timer = window.setInterval(() => void refreshWorkspace(true), 5000)
    return () => window.clearInterval(timer)
  }, [user, hasProcessingWork, refreshWorkspace])

  const navigate = (next: View) => {
    setView(next)
    if (window.innerWidth <= 760) setSidebarOpen(false)
  }
  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2500)
  }

  if (!user) return <Login onLogin={async (email, password) => setUser((await apiLogin(email, password)).user)} />

  return <div className="app-shell">
    <Sidebar user={user} open={sidebarOpen} view={view} onNavigate={navigate} onToggle={() => setSidebarOpen(value => !value)} />
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <main className="main-content">
      <Header user={user} activity={activity} view={view} onNavigate={navigate} onMenu={() => setSidebarOpen(value => !value)} onSearch={() => setSearchOpen(true)} notificationsOpen={notificationsOpen} onNotifications={() => setNotificationsOpen(value => !value)} />
      <div className="page-wrap">
        {view === 'home' && <Home user={user} models={models} activity={activity} onUse={setActiveModel} onHistory={() => navigate('history')} />}
        {view === 'history' && <History activity={activity} />}
        {view === 'usage' && <Usage models={models} balances={balances} summary={usageSummary} />}
        {view === 'settings' && <SettingsView user={user} onUserUpdated={setUser} onSaved={notify} onLogout={() => { clearSession(); setUser(null) }} />}
      </div>
    </main>
    {activeModel && <ModelWorkspace model={activeModel} onClose={() => setActiveModel(null)} onSubmitted={item => { setActivity(items => [item, ...items]); notify('Request sent to the provider') }} />}
    {searchOpen && <CommandSearch models={models} onClose={() => setSearchOpen(false)} onModel={model => { setSearchOpen(false); setActiveModel(model) }} onHistory={() => { setSearchOpen(false); navigate('history') }} />}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>
}

function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password.trim()) return
    setLoading(true); setError('')
    try { await onLogin(email.trim(), password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Login failed.') }
    finally { setLoading(false) }
  }
  return <main className="login-screen">
    <div className="login-glow glow-one"/><div className="login-glow glow-two"/>
    <section className="login-card">
      <Brand />
      <div className="eyebrow">Private creative workspace</div>
      <h1>Welcome back.</h1>
      <p>Log in to continue to your team’s model studio.</p>
      <form onSubmit={submit}>
        <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></label>
        <label>Password<div className="password-field"><input type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={15}/> : <Eye size={15}/>}</button></div></label>
        {error && <div className="login-error">{error}</div>}
        <button className="primary-button login-button" type="submit" disabled={loading}><LockKeyhole size={15}/> {loading ? 'Logging in…' : 'Log in'}</button>
      </form>
      <div className="login-note"><ShieldCheck size={15}/><span>Access is invite-only. Your account is created and approved by an admin.</span></div>
    </section>
    <footer className="login-footer">Cresco Labs <span>·</span> Built for curious teams</footer>
  </main>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? 'brand compact' : 'brand login-brand'}><div className="brand-mark"><img src="/brand/cresco-mark.png" alt="Cresco Labs mark" /></div><span>CRESCO <em>LABS</em></span></div>
}

function Sidebar({ user, open, view, onNavigate, onToggle }: { user: SessionUser; open: boolean; view: View; onNavigate: (view: View) => void; onToggle: () => void }) {
  return <aside className={cx('sidebar', !open && 'collapsed')}>
    <div className="sidebar-brand-row"><Brand compact/><button className="collapse-button" onClick={onToggle} aria-label={open ? 'Collapse side menu' : 'Expand side menu'}><Menu size={17}/></button></div>
    <div className="workspace-switcher"><div className="avatar">CL</div><div><strong>Creative team</strong><small>Private workspace</small></div><ChevronDown size={15}/></div>
    <nav>
      <p className="nav-label">Workspace</p>
      {navItems.slice(0, 2).map(item => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => onNavigate(item.id)} />)}
      <p className="nav-label space-top">Manage</p>
      {navItems.slice(2).map(item => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => onNavigate(item.id)} />)}
    </nav>
    <div className="sidebar-bottom">
      <button className="help-card"><CircleHelp size={17}/><div><strong>Need a hand?</strong><small>Help center</small></div><ArrowUpRight size={14}/></button>
      <div className="user-row"><div className="avatar avatar-small">{initials(user.name)}</div><div><strong>{user.name}</strong><small>{user.role === 'admin' ? 'Administrator' : 'Team member'}</small></div><MoreHorizontal size={17}/></div>
    </div>
  </aside>
}

function NavItem({ item, active, onClick }: { item: typeof navItems[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon
  return <button className={cx('nav-item', active && 'active')} onClick={onClick}><Icon size={17}/><span>{item.label}</span></button>
}

function Header({ user, activity, view, onNavigate, onMenu, onSearch, notificationsOpen, onNotifications }: { user: SessionUser; activity: Activity[]; view: View; onNavigate: (view: View) => void; onMenu: () => void; onSearch: () => void; notificationsOpen: boolean; onNotifications: () => void }) {
  return <header className="topbar">
    <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Toggle menu"><Menu size={19}/></button>
    <div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{navItems.find(item => item.id === view)?.label}</strong></div>
    <nav className="center-nav">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'selected' : ''} onClick={() => onNavigate(item.id)}><Icon size={14}/>{item.label}</button> })}</nav>
      <div className="top-actions">
      <button className="command-search" onClick={onSearch}><Search size={16}/> Search <kbd>⌘ K</kbd></button>
      <div className="notification-wrap"><button className="icon-button" onClick={onNotifications} aria-label="Notifications"><Bell size={18}/>{activity.some(item => item.status !== 'Complete') && <i/>}</button>{notificationsOpen && <Notifications activity={activity} />}</div>
      <div className="avatar avatar-small">{initials(user.name)}</div>
    </div>
  </header>
}

function Notifications({ activity }: { activity: Activity[] }) {
  const items = activity.slice(0, 3)
  return <div className="popover notification-panel"><div className="popover-head"><strong>Recent updates</strong><span>{items.length}</span></div>{items.map(item => <div className="notification-item" key={item.id}><span className="notice-dot"/><div><strong>{item.title}</strong><small>{item.model} · {item.status}</small></div></div>)}{!items.length && <div className="palette-empty">No generation updates yet.</div>}</div>
}

function Home({ user, models, activity, onUse, onHistory }: { user: SessionUser; models: Model[]; activity: Activity[]; onUse: (model: Model) => void; onHistory: () => void }) {
  const today = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
  return <>
    <section className="hero"><div><div className="eyebrow"><span className="pulse"/>{today}</div><h1>Welcome, {user.name.split(' ')[0]} <span>✦</span></h1><p>Your creative workspace is ready. Choose a tool and start with an idea.</p></div>{models.find(model => model.status !== 'Setup') && <button className="primary-button" onClick={() => onUse(models.find(model => model.status !== 'Setup')!)}><Plus size={17}/> Start creating</button>}</section>
    <section className="section-head"><div><h2>Model studio</h2><p>Every approved tool in your workspace, in one place.</p></div><span className="model-count">{models.filter(model => model.status !== 'Setup').length} ready · {models.length} connected</span></section>
    <div className="model-grid">{models.map(model => <ModelCard key={model.id} model={model} onUse={() => onUse(model)} />)}</div>
    <section className="activity-section"><div className="section-head"><div><h2>Recent activity</h2><p>Your latest work across the studio.</p></div><button className="text-button" onClick={onHistory}>See history <ArrowUpRight size={15}/></button></div><ActivityList items={activity.slice(0, 4)} /></section>
    <div className="trust-strip"><ShieldCheck size={17}/><span>Your workspace is private</span><small>Only approved team members can access work and usage data.</small><LockKeyhole size={15} className="lock"/></div>
  </>
}

function ModelCard({ model, onUse }: { model: Model; onUse: () => void }) {
  const Icon = model.icon
  return <article className="model-card">
    <div className={cx('card-art', model.color)}><div className="art-orb"/><div className="art-grid"/><div className="model-icon"><Icon size={20}/></div><span className="model-tag">{model.kind}</span></div>
    <div className="card-body"><div className="model-heading"><div><h3>{model.name}</h3><span>{model.provider}</span></div><span className={cx('status', model.status === 'Beta' && 'beta', model.status === 'Setup' && 'setup')}><i/>{model.status === 'Setup' ? 'Setup required' : model.status}</span></div><p>{model.description}</p><button className="use-button" disabled={model.status === 'Setup'} onClick={onUse}>{model.status === 'Setup' ? 'Waiting for admin setup' : `Use ${model.name}`} {model.status !== 'Setup' && <ArrowUpRight size={15}/>}</button></div>
  </article>
}

function ActivityIcon({ item }: { item: Activity }) {
  const Icon = item.kind === 'Video' ? Film : item.kind === 'Image' ? ImageIcon : MessageSquare
  return <div className={cx('activity-icon', item.color)}><Icon size={18}/></div>
}

function ActivityList({ items, onSelect }: { items: Activity[]; onSelect?: (item: Activity) => void }) {
  return <div className="activity-list">{items.map(item =>
    <button className="activity-row" key={item.id} onClick={() => onSelect?.(item)}>
      <ActivityIcon item={item}/><div className="activity-title"><strong>{item.title}</strong><span>{item.model}</span></div>
      <span className={cx('activity-status', item.status.toLowerCase())}>{item.status}</span><span className="activity-type">{item.kind}</span><span className="activity-time">{item.date}</span><MoreHorizontal size={18} className="muted"/>
    </button>
  )}</div>
}

function History({ activity }: { activity: Activity[] }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'All' | ModelKind>('All')
  const [period, setPeriod] = useState<'30' | '90' | 'all'>('30')
  const [selected, setSelected] = useState<Activity | null>(null)
  const filtered = activity.filter(item => {
    const matchesKind = kind === 'All' || item.kind === kind
    const searchText = [item.title, item.model, item.prompt].join(' ').toLowerCase()
    const cutoff = period === 'all' ? 0 : Date.now() - Number(period) * 86400000
    return matchesKind && searchText.includes(query.toLowerCase()) && new Date(item.createdAt).getTime() >= cutoff
  })
  return <Page title="History" subtitle="Every generation, prompt and result in one searchable timeline.">
    <div className="history-tools">
      <div className="inline-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search prompts and generations"/></div>
      <div className="segmented">{(['All', 'Text', 'Image', 'Video'] as const).map(value => <button key={value} className={kind === value ? 'selected' : ''} onClick={() => setKind(value)}>{value}</button>)}</div>
      <label className="filter-button"><SlidersHorizontal size={15}/><select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select><ChevronDown size={14}/></label>
    </div>
    {filtered.length ? <ActivityList items={filtered} onSelect={setSelected}/> : <EmptyState icon={Search} title="No matching work" text="Try a different search or content type."/>}
    {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)}/>}
  </Page>
}

function DetailDrawer({ item, onClose }: { item: Activity; onClose: () => void }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="detail-drawer" onClick={event => event.stopPropagation()}>
    <button className="close-button" onClick={onClose} aria-label="Close details"><X size={18}/></button>
    <ActivityIcon item={item}/><span className="eyebrow">{item.kind} generation</span><h2>{item.title}</h2>
    <div className="detail-grid"><div><span>Model</span><strong>{item.model}</strong></div><div><span>Status</span><strong>{item.status}</strong></div><div><span>Cost</span><strong>{item.cost}</strong></div><div><span>Created</span><strong>{item.date}</strong></div></div>
    <label className="detail-label">Prompt</label><div className="prompt-copy">{item.prompt}</div>
    {item.outputText && <><label className="detail-label">Response</label><div className="prompt-copy">{item.outputText}</div></>}
    {item.resultUrl && item.kind === 'Image' && <img className="inline-result-media history-result-media" src={item.resultUrl} alt={`${item.title} result`}/>}
    {item.resultUrl && item.kind === 'Video' && <video className="inline-result-media history-result-media" src={item.resultUrl} controls playsInline/>}
    {item.resultUrl ? <div className="inline-result-actions"><button className="inline-result-link primary-download" onClick={() => void downloadResult(item.resultUrl!, item.id, item.kind)}><Download size={15}/> Download</button><a className="inline-result-link" href={item.resultUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/> Open original</a></div> : !item.outputText ? <button className="secondary-button" disabled><Clock3 size={15}/> Result processing</button> : null}
  </aside></div>
}

function Usage({ models, balances, summary }: { models: Model[]; balances: ApiBalance[]; summary: UsageSummary | null }) {
  const total = Number(summary?.spendNanoUsd || 0) / 1_000_000_000
  const totalCalls = Number(summary?.calls || 0)
  const usageRows = summary?.byModel || []
  const balanceTotal = balances.reduce((sum, balance) => sum + balance.amountNanoUsd / 1_000_000_000, 0)
  const monthlyLimit = Number(summary?.budget?.workspaceMonthlyLimitNanoUsd || 0) / 1_000_000_000
  const monthlyCommitted = Number(summary?.monthlyCommittedNanoUsd || 0) / 1_000_000_000
  const providerAccountSpend = Number(summary?.providerUsage?.spendNanoUsd || 0) / 1_000_000_000
  const budgetPercent = monthlyLimit > 0 ? Math.min(100, Math.round(monthlyCommitted / monthlyLimit * 100)) : 0
  return <Page title="Usage & credits" subtitle="Transparent spend for the whole team, with provider reconciliation status.">
    <div className="metric-grid">
      <Metric label="Tracked spend" value={money(total)} detail="Across recorded generations"/>
      <Metric label="Credits remaining" value={money(balanceTotal)} detail="Provider and internal ledgers"/>
      <Metric label="Total calls" value={totalCalls.toLocaleString()} detail={`Across ${models.length} available models`}/>
      <Metric label="Provider account spend" value={summary?.providerUsage ? money(providerAccountSpend) : 'Not synced'} detail="Current month across the connected account"/>
    </div>
    <section className="budget-banner"><div><span>Monthly workspace budget</span><strong>{monthlyLimit > 0 ? `${money(monthlyCommitted)} of ${money(monthlyLimit)}` : 'No hard limit'}</strong><small>{monthlyLimit > 0 ? `${Math.max(0, 100 - budgetPercent)}% remaining · warning at ${summary?.budget?.warnAtPercent || 80}%` : 'An administrator can set a limit in the admin app.'}</small></div><div className="budget-track"><i style={{ width: `${budgetPercent}%` }}/></div></section>
    <section className="usage-section">
      <div className="section-head"><div><h2>Spend by model</h2><p>Provider-confirmed costs replace estimates after reconciliation.</p></div><span className="sync-badge"><Check size={12}/> Synced</span></div>
      <div className="usage-card">
        <div className="table-head"><span>Model</span><span>Calls</span><span>Spend</span><span>Share</span></div>
        {usageRows.map(item => {
          const model = models.find(entry => entry.id === item.modelId)
          const Icon = model?.icon || Bot
          const spend = Number(item.spendNanoUsd || 0) / 1_000_000_000
          const share = total > 0 ? Math.round(spend / total * 100) : 0
          return <div className="usage-row" key={item.modelId}>
            <div className="member"><div className={cx('activity-icon', model?.color || 'sage')}><Icon size={16}/></div><div><strong>{item.name}</strong><small>{item.provider}{model ? '' : ' · Archived'}</small></div></div>
            <span>{item.calls.toLocaleString()}</span><strong>{money(spend)}</strong>
            <div className="share-cell"><div className="share-bar"><i style={{ width: String(share) + '%' }}/></div><small>{share}%</small></div>
          </div>
        })}
      </div>
    </section>
    {summary?.providerUsage && <section className="usage-section">
      <div className="section-head"><div><h2>Provider account usage</h2><p>Account-wide fal billing can include requests made outside Cresco.</p></div><span className="sync-badge"><Check size={12}/> Provider data</span></div>
      <div className="usage-card">
        <div className="table-head"><span>Endpoint</span><span>Units</span><span>Spend</span><span>Provider</span></div>
        {summary.providerUsage.byEndpoint.map(item => <div className="usage-row" key={`${item.provider}:${item.endpointId}`}>
          <div className="member"><div className="activity-icon sage"><Bot size={16}/></div><div><strong>{item.endpointId}</strong><small>Since {new Date(summary.providerUsage!.periodStart).toLocaleDateString()}</small></div></div>
          <span>{item.quantity.toLocaleString()}</span><strong>{money(item.spendNanoUsd / 1_000_000_000)}</strong><span>{item.provider}</span>
        </div>)}
      </div>
    </section>}
    <section className="provider-balances">
      <div className="section-head"><div><h2>Provider balances</h2><p>Visible to the team without exposing credentials.</p></div></div>
      <div className="balance-grid">{balances.map(balance => <Balance key={balance.provider} provider={balance.provider} value={money(balance.amountNanoUsd / 1_000_000_000)} state={balance.source === 'provider' ? 'Live balance' : 'Internal ledger'}/>)}</div>
    </section>
  </Page>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function Balance({ provider, value, state }: { provider: string; value: string; state: string }) {
  return <div className="balance-card"><div><span>{provider}</span><small>{state}</small></div><strong>{value}</strong></div>
}

function SettingsView({ user, onUserUpdated, onSaved, onLogout }: { user: SessionUser; onUserUpdated: (user: SessionUser) => void; onSaved: (message: string) => void; onLogout: () => void }) {
  const [name, setName] = useState(user.name)
  const [completion, setCompletion] = useState(user.preferences?.generationCompleted ?? true)
  const [weekly, setWeekly] = useState(user.preferences?.weeklySummary ?? true)
  const [failed, setFailed] = useState(user.preferences?.generationFailed ?? true)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      const data = await updateMe({ name, preferences: { generationCompleted: completion, weeklySummary: weekly, generationFailed: failed } })
      onUserUpdated(data.user); onSaved('Settings saved')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save settings.') }
    finally { setBusy(false) }
  }
  const changePassword = async () => {
    if (newPassword !== confirmPassword) return setError('The new passwords do not match.')
    setBusy(true); setError('')
    try {
      const data = await updateMe({ currentPassword, newPassword })
      onUserUpdated(data.user); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); onSaved('Password updated')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your password.') }
    finally { setBusy(false) }
  }
  return <Page title="Settings" subtitle="Manage your profile, notifications and active session.">
    <div className="settings-layout">
      <section className="settings-panel">
        <div className="settings-heading"><Users size={18}/><div><h3>Profile</h3><p>Your member details are visible to teammates.</p></div></div>
        <div className="form-grid"><label>Full name<input value={name} onChange={event => setName(event.target.value)}/></label><label>Email address<input value={user.email} readOnly type="email" title="Email changes are managed by an administrator"/></label></div>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><Bell size={18}/><div><h3>Notifications</h3><p>Choose the updates that matter to you.</p></div></div>
        <Toggle label="Generation completed" detail="When an image or video is ready" checked={completion} onChange={setCompletion}/>
        <Toggle label="Weekly usage summary" detail="A Monday overview of team spend" checked={weekly} onChange={setWeekly}/>
        <Toggle label="Failed generations" detail="When a request needs attention" checked={failed} onChange={setFailed}/>
        <button className="primary-button small" disabled={busy || name.trim().length < 2} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>
      </section>
      <section className="settings-panel">
        <div className="settings-heading"><LockKeyhole size={18}/><div><h3>Change password</h3><p>Updating it signs out any other active sessions.</p></div></div>
        <div className="form-grid password-grid"><label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}/></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/></label></div>
        <button className="secondary-button" disabled={busy || !currentPassword || newPassword.length < 10 || !confirmPassword} onClick={changePassword}>{busy ? 'Updating…' : 'Update password'}</button>
      </section>
      {error && <div className="login-error settings-error">{error}</div>}
      <section className="settings-panel danger-panel">
        <div className="settings-heading"><LockKeyhole size={18}/><div><h3>Session</h3><p>You are signed in on this browser.</p></div></div>
        <div className="session-row"><div><strong>Current device</strong><span>Windows · Active now</span></div><span className="current-badge">Current</span></div>
        <button className="danger-button" onClick={onLogout}>Log out</button>
      </section>
    </div>
  </Page>
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="toggle-row"><div><strong>{label}</strong><span>{detail}</span></div><button className={cx('toggle', checked && 'on')} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i/></button></div>
}

function ModelWorkspace({ model, onClose, onSubmitted }: { model: Model; onClose: () => void; onSubmitted: (item: Activity) => void }) {
  const [prompt, setPrompt] = useState('')
  const [generation, setGeneration] = useState<ApiGeneration | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aspect, setAspect] = useState(model.kind === 'Image' ? '1:1' : '16:9')
  const [quality, setQuality] = useState(model.kind === 'Video' ? '720p' : 'Standard')
  const [duration, setDuration] = useState('10 seconds')
  const [depth, setDepth] = useState('Balanced')
  const [length, setLength] = useState('Auto length')
  const [references, setReferences] = useState<ApiUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const Icon = model.icon
  useEffect(() => {
    if (!generation || generation.status !== 'queued') return
    let active = true
    let timer = 0
    const poll = async () => {
      try {
        const next = (await getGeneration(generation.id)).generation
        if (!active) return
        setGeneration(next)
        if (next.status === 'queued') timer = window.setTimeout(poll, 2000)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not refresh the provider response.')
      }
    }
    timer = window.setTimeout(poll, 1200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [generation?.id, generation?.status])
  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return
    const available = Math.max(0, 5 - references.length)
    if (!available) return setError('You can attach up to five reference files.')
    setUploading(true); setError('')
    try {
      const uploaded = await Promise.all(Array.from(files).slice(0, available).map(file => uploadReference(file)))
      setReferences(items => [...items, ...uploaded.map(item => item.upload)])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload this reference.')
    } finally { setUploading(false) }
  }
  const generate = async () => {
    if (!prompt.trim()) return
    setBusy(true); setError('')
    try {
      const options: Record<string, string> = model.kind === 'Video' ? { aspect, quality, duration } : model.kind === 'Image' ? { aspect, quality } : { depth, length }
      const response = (await submitGeneration(model.id, prompt.trim(), options, references.map(item => item.id))).generation
      setGeneration(response)
      onSubmitted({ id: response.id, title: response.title, model: model.name, date: 'Just now', kind: model.kind, color: model.color, cost: money(Number(response.costNanoUsd || 0) / 1_000_000_000), status: response.status === 'complete' ? 'Complete' : response.status === 'failed' ? 'Failed' : 'Processing', prompt: response.prompt, resultUrl: response.resultUrl, outputText: response.outputText, createdAt: response.createdAt })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send this request.')
    } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="modal workspace-modal" onClick={event => event.stopPropagation()}>
    <button className="close-button" onClick={onClose} aria-label="Close workspace"><X size={18}/></button>
    <div className={cx('modal-icon', model.color)}><Icon size={25}/></div>
    <span className="eyebrow">{model.provider} · {model.kind} workspace</span>
    <h2>Create with {model.name}</h2>
    <p>{model.kind === 'Video' ? 'Describe a scene, set the format and add optional reference media.' : model.kind === 'Image' ? 'Describe an image, choose a format and add an optional reference.' : 'Write a prompt, add context and get a thoughtful response.'}</p>
    {model.kind !== 'Text' && <div className="workspace-options">
      <Select value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '4:3']}/>
      {model.kind === 'Video' && <Select value={duration} onChange={setDuration} options={['5 seconds', '10 seconds', '15 seconds']}/>} 
      <Select value={quality} onChange={setQuality} options={model.kind === 'Video' ? ['480p', '720p', '1080p'] : ['Standard', 'High']}/>
    </div>}
    {model.kind === 'Text' && <div className="workspace-options"><Select value={depth} onChange={setDepth} options={['Fast', 'Balanced', 'Deep']}/><Select value={length} onChange={setLength} options={['Short', 'Auto length', 'Long']}/></div>}
    <textarea value={prompt} onChange={event => { setPrompt(event.target.value); setGeneration(null) }} placeholder={model.kind === 'Video' ? 'Describe the scene, action, camera and mood…' : model.kind === 'Image' ? 'Describe the composition, subject, light and style…' : 'Ask anything or describe what you want to make…'}/>
    {model.kind !== 'Text' && <><label className={cx('upload-hint', uploading && 'uploading')}><Upload size={15}/> {uploading ? 'Uploading reference…' : `Add reference ${model.kind === 'Video' ? 'images, video or audio' : 'image'}`} <span>{references.length}/5</span><input type="file" multiple accept={model.kind === 'Video' ? 'image/*,video/*,audio/*' : 'image/*'} disabled={uploading || references.length >= 5} onChange={event => { void addReferences(event.target.files); event.target.value = '' }} hidden/></label>{references.length > 0 && <div className="reference-list">{references.map(reference => <div className="reference-chip" key={reference.id}><div><strong>{reference.fileName}</strong><span>{(reference.size / 1024 / 1024).toFixed(reference.size > 1024 * 1024 ? 1 : 2)} MB</span></div><button onClick={() => setReferences(items => items.filter(item => item.id !== reference.id))} aria-label={`Remove ${reference.fileName}`}><X size={13}/></button></div>)}</div>}</>}
    {error && <div className="login-error">{error}</div>}
    {generation?.status === 'queued' && <div className="result-preview processing"><span className="result-spinner"/><div><strong>Provider is processing</strong><span>Your request was sent immediately. This page will update as soon as the result is ready.</span></div></div>}
    {generation?.status === 'failed' && <div className="result-preview failed"><X size={17}/><div><strong>Request failed</strong><span>{generation.error || 'The provider could not complete this request.'}</span></div></div>}
    {generation?.status === 'complete' && <div className="inline-result"><div className="inline-result-head"><Sparkles size={19}/><div><strong>Result ready</strong><span>Returned by {model.provider}</span></div></div>{generation.outputText && <div className="inline-result-text">{generation.outputText}</div>}{generation.resultUrl && model.kind === 'Image' && <img className="inline-result-media" src={generation.resultUrl} alt={`${model.name} result`}/>} {generation.resultUrl && model.kind === 'Video' && <video className="inline-result-media" src={generation.resultUrl} controls playsInline/>}{generation.resultUrl && <div className="inline-result-actions"><button className="inline-result-link primary-download" onClick={() => void downloadResult(generation.resultUrl!, generation.id, model.kind)}><Download size={15}/> Download</button><a className="inline-result-link" href={generation.resultUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/> Open original</a></div>}</div>}
    <div className="workspace-footer"><span>Estimated cost · <strong>{model.estimate}</strong></span><button className="primary-button" disabled={!prompt.trim()||busy||uploading} onClick={generate}><Sparkles size={15}/> {busy?'Sending…':generation?.status==='queued'?'Send another':'Generate'}</button></div>
  </section></div>
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="select-control"><select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select><ChevronDown size={13}/></label>
}

function CommandSearch({ models, onClose, onModel, onHistory }: { models: Model[]; onClose: () => void; onModel: (model: Model) => void; onHistory: () => void }) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => models.filter(model => [model.name, model.provider, model.kind].join(' ').toLowerCase().includes(query.toLowerCase())), [query])
  return <div className="modal-backdrop search-backdrop" onClick={onClose}><section className="command-palette" onClick={event => event.stopPropagation()}>
    <div className="palette-input"><Search size={18}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search models, history and actions…"/><button onClick={onClose}>ESC</button></div>
    <div className="palette-results"><span className="palette-label">Models</span>{matches.map(model => { const Icon = model.icon; return <button key={model.id} disabled={model.status === 'Setup'} onClick={() => onModel(model)}><div className={cx('activity-icon', model.color)}><Icon size={16}/></div><div><strong>{model.name}</strong><small>{model.provider} · {model.status === 'Setup' ? 'Setup required' : model.kind}</small></div>{model.status !== 'Setup' && <ArrowUpRight size={15}/>}</button> })}{!matches.length && <div className="palette-empty">No matching models</div>}<span className="palette-label">Actions</span><button onClick={onHistory}><div className="activity-icon sage"><Clock3 size={16}/></div><div><strong>Open full history</strong><small>Search every generation</small></div><ArrowUpRight size={15}/></button></div>
  </section></div>
}

function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <><section className="page-heading"><div><div className="eyebrow">Workspace</div><h1>{title}</h1><p>{subtitle}</p></div></section>{children}</>
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Bot; title: string; text: string }) {
  return <div className="empty-state"><div><Icon size={20}/></div><h3>{title}</h3><p>{text}</p></div>
}
