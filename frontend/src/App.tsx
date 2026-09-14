import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Gauge, LayoutGrid, LogOut, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import { clearSession, login as apiLogin, restoreSession, type SessionUser } from './api'
import { Avatar, KindChip, Menu as PopMenu, Toast } from './components'
import { applyTheme, storedTheme, useWorkspace, WorkspaceProvider } from './lib/store'
import { Link, matchRoute, RouterProvider, useRouter } from './lib/router'
import { cx } from './lib/format'
import LoginPage from './pages/login'
import HomePage from './pages/home'
import ModelPage from './pages/model'
import HistoryPage, { GenerationPage } from './pages/history'
import UsagePage from './pages/usage'
import SettingsPage from './pages/settings'

applyTheme(storedTheme())

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(() => restoreSession())
  const [toast, setToast] = useState('')

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => (current === message ? '' : current)), 2600)
  }, [])

  const signOut = useCallback(() => {
    clearSession()
    setUser(null)
    window.history.pushState({}, '', '/')
  }, [])

  if (!user) return <><LoginPage onLogin={async (email, password) => setUser((await apiLogin(email, password)).user)} /><Toast message={toast} /></>

  return <RouterProvider>
    <WorkspaceProvider user={user} setUser={setUser} onToast={notify} signOut={signOut}>
      <Shell />
      <Toast message={toast} />
    </WorkspaceProvider>
  </RouterProvider>
}

const navItems = [
  { to: '/', label: 'Home', icon: LayoutGrid },
  { to: '/history', label: 'History', icon: Clock3 },
  { to: '/usage', label: 'Usage', icon: Gauge },
]

function Shell() {
  const { path } = useRouter()
  const { models, user, signOut, sessions, rename, archive, toast } = useWorkspace()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)

  useEffect(() => { setDrawer(false) }, [path])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(value => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const modelRoute = matchRoute('/m/:id', path)
  const threadRoute = matchRoute('/c/:id', path)
  const generationRoute = matchRoute('/g/:id', path)
  const thread = threadRoute ? sessions.find(item => item.id === threadRoute.id) : null
  const activeModel = models.find(item => item.id === (modelRoute?.id || thread?.modelId))
  const isChat = Boolean(modelRoute || threadRoute)

  const crumb = modelRoute ? activeModel?.name || 'Model'
    : threadRoute ? thread?.title || 'Thread'
    : generationRoute ? 'Generation'
    : navItems.find(item => item.to === path)?.label
    || (path === '/settings' ? 'Settings' : 'Not found')

  const page = modelRoute ? <ModelPage modelId={modelRoute.id} />
    : threadRoute ? <ModelPage sessionId={threadRoute.id} />
    : generationRoute ? <GenerationPage generationId={generationRoute.id} />
    : path === '/history' ? <HistoryPage />
    : path === '/usage' ? <UsagePage />
    : path === '/settings' ? <SettingsPage />
    : path === '/' ? <HomePage />
    : <NotFound />

  return <div className="shell">
    <aside className={cx('sidebar', collapsed && 'rail', drawer && 'open')}>
      <div className="sidebar-head">
        <Link className="brand" to="/"><img src="/brand/cresco-mark.png" alt="" />{!collapsed && <span>Cresco Labs</span>}</Link>
      </div>
      <div className="sidebar-scroll">
        {navItems.map(item => {
          const Icon = item.icon
          return <Link key={item.to} className={cx('nav-item', path === item.to && 'active')} to={item.to}>
            <Icon size={15} /><span>{item.label}</span>
          </Link>
        })}

        {!collapsed && <div className="sidebar-section"><span className="label">New</span></div>}
        {models.filter(model => model.state !== 'setup').map(model => (
          <Link key={model.id} className={cx('nav-item', modelRoute?.id === model.id && 'active')} to={`/m/${model.id}`} title={`New with ${model.name}`}>
            <span className={cx('kind-dot', `kind-${model.kind}`)} style={{ marginLeft: 4, marginRight: 1 }} />
            <span>{model.name}</span>
            <Plus size={13} className="nav-trail" />
          </Link>
        ))}
        {!models.length && !collapsed && <p className="field-hint" style={{ padding: '6px 8px' }}>No models connected yet.</p>}

        {!collapsed && sessions.length > 0 && <div className="sidebar-section"><span className="label">Recent</span></div>}
        {!collapsed && sessions.slice(0, 20).map(item => {
          const model = models.find(entry => entry.id === item.modelId)
          return <div key={item.id} className={cx('thread-item', threadRoute?.id === item.id && 'active')}>
            <Link className="nav-item" to={`/c/${item.id}`} title={item.title}>
              <span className={cx('kind-dot', `kind-${model?.kind || 'text'}`)} style={{ marginLeft: 4, marginRight: 1 }} />
              <span>{item.title}</span>
            </Link>
            <PopMenu
              align="right"
              trigger={({ toggle }) => <button className="thread-more" onClick={toggle} aria-label={`Options for ${item.title}`}><MoreHorizontal size={14} /></button>}
            >
              {close => <>
                <button onClick={() => {
                  close()
                  const next = window.prompt('Rename thread', item.title)
                  if (next?.trim()) void rename(item.id, next.trim()).catch(() => toast('Could not rename that thread.'))
                }}>Rename</button>
                <button className="danger" onClick={() => {
                  close()
                  void archive(item.id)
                    .then(() => { if (threadRoute?.id === item.id) window.history.pushState({}, '', '/') })
                    .catch(() => toast('Could not remove that thread.'))
                }}>Remove from list</button>
              </>}
            </PopMenu>
          </div>
        })}
      </div>
      <div className="sidebar-foot">
        <PopMenu
          align="left"
          trigger={({ toggle }) => (
            <button className="user-row" onClick={toggle}>
              <Avatar name={user.name} />
              <span className="user-meta">
                <strong>{user.name}</strong>
                <small>{user.role === 'admin' ? 'Administrator' : 'Team member'}</small>
              </span>
            </button>
          )}
        >
          {close => <>
            <div className="menu-label label">{user.email}</div>
            <Link className="nav-item" to="/settings" onClick={close}><SettingsIcon size={14} /><span>Settings</span></Link>
            <button className="danger" onClick={() => { close(); signOut() }}><LogOut size={14} /> Sign out</button>
          </>}
        </PopMenu>
      </div>
    </aside>

    {drawer && <button className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

    <main className="main">
      <header className="topbar">
        <button className="btn btn-icon only-mobile" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={17} /></button>
        <button
          className="btn btn-icon"
          onClick={() => setCollapsed(value => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ display: window.innerWidth <= 860 ? 'none' : undefined }}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="crumbs"><strong>{crumb}</strong></div>
        <div className="topbar-actions">
          {isChat && activeModel && <Link className="btn btn-secondary btn-sm" to={`/m/${activeModel.id}`}><Plus size={13} /> New</Link>}
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <Search size={14} /><span>Search</span><kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      {isChat ? page : <div className="scroll-area">{page}</div>}
    </main>

    {palette && <CommandPalette onClose={() => setPalette(false)} />}
  </div>
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { models } = useWorkspace()
  const { navigate } = useRouter()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const modelHits = models
      .filter(model => model.state !== 'setup')
      .filter(model => !needle || [model.name, model.provider, model.kind].join(' ').toLowerCase().includes(needle))
      .map(model => ({ key: model.id, to: `/m/${model.id}`, title: model.name, subtitle: `${model.provider} · ${model.kind}`, kind: model.kind }))
    const pages = navItems
      .concat([{ to: '/settings', label: 'Settings', icon: SettingsIcon }])
      .filter(item => !needle || item.label.toLowerCase().includes(needle))
      .map(item => ({ key: item.to, to: item.to, title: item.label, subtitle: 'Go to page', kind: null }))
    return [...modelHits, ...pages]
  }, [models, query])

  useEffect(() => { setCursor(0) }, [query])

  const go = (to: string) => { onClose(); navigate(to) }

  return <div className="overlay" onClick={onClose}>
    <div className="palette" onClick={event => event.stopPropagation()} role="dialog" aria-label="Search">
      <div className="palette-input">
        <Search size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Search models and pages…"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(value => Math.min(value + 1, results.length - 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(value => Math.max(value - 1, 0)) }
            if (event.key === 'Enter' && results[cursor]) go(results[cursor].to)
          }}
        />
      </div>
      <div className="palette-list">
        {results.length ? results.map((result, index) => (
          <button key={result.key} className={cx('palette-item', index === cursor && 'cursor')} onMouseEnter={() => setCursor(index)} onClick={() => go(result.to)}>
            {result.kind ? <KindChip kind={result.kind} size={24} /> : <span className="kind-chip" style={{ width: 24, height: 24 }}><Sparkles size={13} /></span>}
            <span><strong>{result.title}</strong><small>{result.subtitle}</small></span>
          </button>
        )) : <div className="palette-empty">Nothing matches “{query}”.</div>}
      </div>
    </div>
  </div>
}

function NotFound() {
  return <div className="page"><div className="empty"><h3>Page not found</h3><p>That address does not exist.</p><Link className="btn btn-secondary btn-sm" to="/">Back to home</Link></div></div>
}
