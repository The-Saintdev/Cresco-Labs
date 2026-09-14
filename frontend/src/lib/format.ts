export const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

export const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

export const nanoMoney = (value: number | undefined | null) => money(Number(value || 0) / 1_000_000_000)

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()

const absolute = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export const formatDate = (value: string) => absolute.format(new Date(value))

export function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.round(elapsed / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return absolute.format(new Date(value))
}

export function formatDuration(ms: number | null | undefined) {
  if (!ms || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
}

// Fetches the asset so the browser saves it instead of navigating away; falls
// back to opening the original URL when the provider blocks cross-origin reads.
export async function downloadResult(url: string, id: string, kind: string) {
  const extension = (() => {
    try {
      return new URL(url).pathname.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 5) || ''
    } catch {
      return ''
    }
  })() || (kind === 'video' ? 'mp4' : 'png')
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
