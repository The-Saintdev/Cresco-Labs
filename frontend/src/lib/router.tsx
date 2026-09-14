import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type RouterValue = { path: string; navigate: (to: string, options?: { replace?: boolean }) => void; syncPath: () => void }

const RouterContext = createContext<RouterValue>({ path: '/', navigate: () => {}, syncPath: () => {} })

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname || '/')

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (to === window.location.pathname) return
    window.history[options.replace ? 'replaceState' : 'pushState']({}, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

  // Adopts a URL that was already changed with replaceState. Used when a page
  // claims a deeper URL mid-task and must not be remounted while work is in
  // flight; calling this afterwards brings the router back in step.
  const syncPath = useCallback(() => setPath(window.location.pathname || '/'), [])

  const value = useMemo(() => ({ path, navigate, syncPath }), [path, navigate, syncPath])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter() {
  return useContext(RouterContext)
}

// Matches '/m/:id' style patterns and returns the captured params, or null.
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual)
    else if (expected !== actual) return null
  }
  return params
}

// Plain anchors so links are real URLs: middle-click, copy-link and open-in-new-tab
// all behave the way the browser expects.
export function Link({ to, className, children, onClick, title }: { to: string; className?: string; children: ReactNode; onClick?: () => void; title?: string }) {
  const { navigate } = useRouter()
  return <a
    href={to}
    className={className}
    title={title}
    onClick={event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      onClick?.()
      navigate(to)
    }}
  >{children}</a>
}
