import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, FileText, Film, Image as ImageIcon, type LucideIcon } from 'lucide-react'
import { cx, initials } from './lib/format'
import type { Kind, ModelStatus } from './lib/store'

export const kindIcon: Record<Kind, LucideIcon> = { text: FileText, image: ImageIcon, video: Film }

export function KindChip({ kind, size = 26 }: { kind: Kind; size?: number }) {
  const Icon = kindIcon[kind]
  return <span className={cx('kind-chip', kind)} style={{ width: size, height: size }}><Icon size={Math.round(size * 0.55)} /></span>
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={cx('avatar', large && 'lg')} aria-hidden>{initials(name)}</span>
}

const statusLabel: Record<ModelStatus, string> = { ready: 'Ready', beta: 'Beta', setup: 'Setup needed' }

export function ModelStatusBadge({ state }: { state: ModelStatus }) {
  return <span className={cx('badge', state === 'ready' && 'badge-ready', state === 'beta' && 'badge-beta', state === 'setup' && 'badge-setup')}>
    {state !== 'setup' && <i />}{statusLabel[state]}
  </span>
}

export function GenerationStatusBadge({ status }: { status: 'complete' | 'failed' | 'queued' }) {
  if (status === 'complete') return <span className="badge badge-ready"><i />Complete</span>
  if (status === 'failed') return <span className="badge badge-failed"><i />Failed</span>
  return <span className="badge badge-running"><i />Running</span>
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

export function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return <div className={cx('meter', clamped >= 100 && 'over', clamped >= 80 && clamped < 100 && 'warn')}>
    <i style={{ width: `${clamped}%` }} />
  </div>
}

export function Switch({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="switch-row">
    <div><strong>{label}</strong><small>{detail}</small></div>
    <button className={cx('switch', checked && 'on')} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><i /></button>
  </div>
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><Icon size={20} /><h3>{title}</h3><p>{text}</p>{action}</div>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return <div className={cx('notice', tone === 'error' ? 'notice-error' : 'notice-info')}>{children}</div>
}

export function Toast({ message }: { message: string }) {
  if (!message) return null
  return <div className="toast" role="status"><Check size={14} />{message}</div>
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="segmented" role="tablist">
    {options.map(option => (
      <button key={option.value} role="tab" aria-selected={value === option.value} className={cx(value === option.value && 'on')} onClick={() => onChange(option.value)}>
        {option.label}
      </button>
    ))}
  </div>
}

// Anchored popup that closes on outside click or Escape.
export function Menu({ trigger, children, align = 'left' }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return <div ref={holder} style={{ position: 'relative' }}>
    {trigger({ open, toggle: () => setOpen(value => !value) })}
    {open && <div className="menu" style={align === 'right' ? { right: 0, bottom: '100%', marginBottom: 6 } : { left: 0, bottom: '100%', marginBottom: 6 }}>
      {children(() => setOpen(false))}
    </div>}
  </div>
}
