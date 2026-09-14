/**
 * Shared design tokens for the Cresco mobile apps.
 * Same system as the web: neutral surfaces, one accent, colour reserved for
 * state and model kind. Light and dark are both first-class.
 */

export type Scheme = 'light' | 'dark'

export type Theme = {
  bg: string
  bgSubtle: string
  bgRaised: string
  bgSunken: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textFaint: string
  accent: string
  accentText: string
  accentWeak: string
  danger: string
  dangerWeak: string
  warn: string
  warnWeak: string
  success: string
  successWeak: string
  kindText: string
  kindImage: string
  kindVideo: string
  overlay: string
}

export const themes: Record<Scheme, Theme> = {
  light: {
    bg: '#ffffff',
    bgSubtle: '#f7f8f7',
    bgRaised: '#ffffff',
    bgSunken: '#f0f2f0',
    border: '#e3e7e3',
    borderStrong: '#cfd5cf',
    text: '#101313',
    textMuted: '#5c665f',
    textFaint: '#8a938c',
    accent: '#4d7c2a',
    accentText: '#ffffff',
    accentWeak: '#eaf2e2',
    danger: '#b4452f',
    dangerWeak: '#fbeae6',
    warn: '#9a7315',
    warnWeak: '#f8f0dc',
    success: '#3f7d3b',
    successWeak: '#e8f2e6',
    kindText: '#4a7f96',
    kindImage: '#7d6aa8',
    kindVideo: '#c06a45',
    overlay: 'rgba(10,12,11,0.44)',
  },
  dark: {
    bg: '#0c0e0d',
    bgSubtle: '#121514',
    bgRaised: '#171a19',
    bgSunken: '#0a0c0b',
    border: '#242927',
    borderStrong: '#363c39',
    text: '#edf0ee',
    textMuted: '#9aa49d',
    textFaint: '#6d7873',
    accent: '#a5d178',
    accentText: '#0c1206',
    accentWeak: '#1c2517',
    danger: '#e98f77',
    dangerWeak: '#2a1a16',
    warn: '#ddba69',
    warnWeak: '#2a2317',
    success: '#9ccb84',
    successWeak: '#1a2416',
    kindText: '#7da8bd',
    kindImage: '#b7a7d5',
    kindVideo: '#e99a7a',
    overlay: 'rgba(0,0,0,0.6)',
  },
}

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }

export const type = {
  h1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  meta: { fontSize: 12, fontWeight: '400' as const },
  mono: { fontSize: 13, fontWeight: '500' as const },
}

export function kindColor(theme: Theme, kind: 'text' | 'image' | 'video') {
  return kind === 'image' ? theme.kindImage : kind === 'video' ? theme.kindVideo : theme.kindText
}

export const money = (nano: number | undefined | null) =>
  (Number(nano || 0) / 1_000_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.round(elapsed / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function elapsed(ms: number | null | undefined) {
  if (!ms || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}

/** Legacy alias kept so nothing breaks mid-refactor. */
export const colors = themes.light
