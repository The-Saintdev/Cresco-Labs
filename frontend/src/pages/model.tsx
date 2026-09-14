import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Download, ExternalLink, Info, Paperclip, Pencil, RotateCcw, Square, X } from 'lucide-react'
import {
  generationErrorMessage, getSession, streamGeneration, submitGeneration, uploadReference,
  type ApiGeneration, type ApiSession, type ApiUpload,
} from '../api'
import { Empty, GenerationStatusBadge, KindChip, Notice, kindIcon } from '../components'
import { cx, downloadResult, formatDuration, nanoMoney, relativeTime } from '../lib/format'
import { useWorkspace, type ModelView } from '../lib/store'
import { useRouter } from '../lib/router'

export default function ModelPage({ modelId, sessionId }: { modelId?: string; sessionId?: string }) {
  const { models, sessions, loading } = useWorkspace()
  const thread = sessionId ? sessions.find(item => item.id === sessionId) : null
  const resolvedId = modelId || thread?.modelId
  const model = models.find(item => item.id === resolvedId)

  // A thread opened from a deep link may not be in the cached list yet; the
  // thread component loads it and reports the model back.
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null)
  const fallbackModel = models.find(item => item.id === loadedModelId)
  const active = model || fallbackModel

  if (!active) {
    if (loading || (sessionId && !loadedModelId)) {
      return <div className="page"><Thread key={sessionId} sessionId={sessionId} model={null} onModelResolved={setLoadedModelId} /></div>
    }
    return <div className="page"><Empty icon={Info} title="Model not found" text="This model may have been archived, or it is not available to your account." /></div>
  }
  if (active.state === 'setup') {
    return <div className="page"><Empty icon={Info} title={`${active.name} is not ready`} text="An administrator still needs to add a provider key or endpoint for this model." /></div>
  }
  return <Thread key={sessionId || `new-${active.id}`} sessionId={sessionId} model={active} onModelResolved={setLoadedModelId} />
}

type Pending = { key: string; prompt: string; response: string; error?: string }

function Thread({ sessionId, model, onModelResolved }: { sessionId?: string; model: ModelView | null; onModelResolved: (id: string) => void }) {
  const { addGeneration, refresh, upsertSession, generations, toast } = useWorkspace()
  const { syncPath } = useRouter()

  const [history, setHistory] = useState<ApiGeneration[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ApiGeneration | null>(null)

  const [aspect, setAspect] = useState('16:9')
  const [quality, setQuality] = useState('Standard')
  const [duration, setDuration] = useState('10 seconds')
  const [references, setReferences] = useState<ApiUpload[]>([])
  const [uploading, setUploading] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  const kind = model?.kind || 'text'

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void getSession(sessionId)
      .then(data => {
        if (!alive) return
        setHistory(data.generations)
        upsertSession(data.session)
        onModelResolved(data.session.modelId)
      })
      .catch(() => { if (alive) setError('This thread could not be loaded.') })
    return () => { alive = false }
  }, [sessionId, upsertSession, onModelResolved])

  // Media jobs finish server-side; the workspace poll carries the update here.
  useEffect(() => {
    if (!sessionId || kind === 'text') return
    setHistory(items => items.map(item => generations.find(entry => entry.id === item.id) || item))
  }, [generations, sessionId, kind])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [history.length, pending?.response])

  const grow = useCallback(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`
  }, [])
  useEffect(grow, [prompt, grow])

  useEffect(() => {
    if (kind === 'image') setQuality('Standard')
    if (kind === 'video') setQuality('720p')
  }, [kind])

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const room = Math.max(0, 5 - references.length)
    if (!room) return setError('You can attach up to five references.')
    setUploading(true); setError('')
    try {
      const uploaded = await Promise.all(Array.from(files).slice(0, room).map(file => uploadReference(file)))
      setReferences(items => [...items, ...uploaded.map(item => item.upload)])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That reference could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  const send = async (text: string) => {
    const value = text.trim()
    if (!value || !model || busy) return
    setError('')
    setBusy(true)

    if (kind === 'text') {
      const key = `pending-${Date.now()}`
      setPending({ key, prompt: value, response: '' })
      setPrompt('')
      const controller = new AbortController()
      abort.current = controller
      try {
        const final = await streamGeneration(model.id, value, {}, [], {
          onMeta: (_generation, session) => {
            if (!session) return
            upsertSession(session)
            // Claim the thread URL without a router update: a re-render here would
            // unmount this component and orphan the stream still being read.
            if (!sessionId) window.history.replaceState({}, '', `/c/${session.id}`)
          },
          onDelta: chunk => setPending(current => (current && current.key === key ? { ...current, response: current.response + chunk } : current)),
        }, controller.signal, sessionId)
        setHistory(items => [...items, final])
        setPending(null)
        addGeneration(final)
        void refresh(true)
      } catch (reason) {
        if (controller.signal.aborted) {
          const partial = pendingRef.current
          if (partial?.response) setHistory(items => [...items, syntheticGeneration(partial, model)])
          setPending(null)
        } else {
          setPending(current => (current && current.key === key ? { ...current, error: reason instanceof Error ? reason.message : 'generation_failed' } : current))
        }
      } finally {
        abort.current = null
        setBusy(false)
        box.current?.focus()
        if (!sessionId) syncPath()
      }
      return
    }

    try {
      const options: Record<string, string> = kind === 'video' ? { aspect, quality, duration } : { aspect, quality }
      const created = (await submitGeneration(model.id, value, options, references.map(item => item.id), sessionId)).generation
      setHistory(items => [...items, created])
      addGeneration(created)
      setPrompt(''); setReferences([])
      void refresh(true)
      if (!sessionId && created.sessionId) {
        window.history.replaceState({}, '', `/c/${created.sessionId}`)
        syncPath()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  // Feeding a finished result back in as a reference is how an existing image or
  // video gets edited: the provider receives it alongside the new prompt.
  const editFrom = async (generation: ApiGeneration) => {
    if (!generation.resultUrl) return
    setPreview(null)
    setError('')
    setUploading(true)
    try {
      const response = await fetch(generation.resultUrl)
      if (!response.ok) throw new Error('fetch_failed')
      const blob = await response.blob()
      const extension = generation.kind === 'video' ? 'mp4' : 'png'
      const file = new File([blob], `cresco-${generation.id}.${extension}`, { type: blob.type || (generation.kind === 'video' ? 'video/mp4' : 'image/png') })
      const uploaded = await uploadReference(file)
      setReferences(items => [...items.filter(item => item.id !== uploaded.upload.id), uploaded.upload].slice(0, 5))
      setPrompt(current => current || 'Edit this: ')
      toast('Added as a reference')
      box.current?.focus()
    } catch {
      setError('That result could not be reused. Some providers block direct downloads; download it and attach it manually.')
    } finally {
      setUploading(false)
    }
  }

  const stop = () => abort.current?.abort()
  const empty = !history.length && !pending

  return <div className={cx('chat', kind !== 'text' && preview && 'with-preview')}>
    <div className="thread-body">
      <div className="chat-scroll">
        <div className="chat-inner">
          {empty && model && <div className="chat-empty">
            <KindChip kind={kind} size={38} />
            <h2>{model.name}</h2>
            <p>{model.blurb}</p>
            {kind === 'text' && <div className="chat-suggestions">
              {['Summarise this in five bullets', 'Draft a short announcement', 'Explain this like I am new to it'].map(suggestion => (
                <button key={suggestion} onClick={() => { setPrompt(suggestion); box.current?.focus() }}>{suggestion}</button>
              ))}
            </div>}
          </div>}

          {history.map(item => <ThreadTurn
            key={item.id}
            generation={item}
            modelName={model?.name || item.modelName || ''}
            onRetry={() => void send(item.prompt)}
            onPreview={() => setPreview(item)}
            onEdit={() => void editFrom(item)}
          />)}

          {pending && <div className="turn" key={pending.key}>
            <div className="turn user"><div className="bubble-user">{pending.prompt}</div></div>
            <div className="turn">
              <div className="turn-head">
                <KindChip kind="text" size={20} />
                <strong>{model?.name}</strong>
                {!pending.error && <span className="spinner" />}
              </div>
              {pending.error
                ? <div className="turn-error"><X size={15} /><div><strong>Request failed</strong>{generationErrorMessage(pending.error)}</div></div>
                : <div className="response streaming">{pending.response}</div>}
            </div>
          </div>}
          <div ref={bottom} />
        </div>
      </div>

      <div className="composer-wrap">
        {error && <div style={{ maxWidth: 'var(--measure)', margin: '0 auto 10px' }}><Notice tone="error">{error}</Notice></div>}
        <div className="composer">
          <textarea
            ref={box}
            rows={1}
            value={prompt}
            placeholder={kind === 'text' ? `Message ${model?.name || 'the model'}…` : kind === 'video' ? 'Describe the scene, action, camera and mood…' : 'Describe the subject, composition, light and style…'}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(prompt)
              }
            }}
          />

          {kind !== 'text' && <div className="option-row">
            <Pill value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '4:3']} />
            <Pill value={quality} onChange={setQuality} options={kind === 'video' ? ['480p', '720p', '1080p'] : ['Standard', 'High']} />
            {kind === 'video' && <Pill value={duration} onChange={setDuration} options={['5 seconds', '10 seconds', '15 seconds']} />}
          </div>}

          {references.length > 0 && <div className="attachments">
            {references.map(reference => <div className="attachment" key={reference.id}>
              <span>{reference.fileName}</span>
              <button onClick={() => setReferences(items => items.filter(item => item.id !== reference.id))} aria-label={`Remove ${reference.fileName}`}><X size={12} /></button>
            </div>)}
          </div>}

          <div className="composer-foot">
            {kind !== 'text' && <>
              <label className="btn btn-ghost btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Reference'}
                <input type="file" multiple hidden accept={kind === 'video' ? 'image/*,video/*,audio/*' : 'image/*'} disabled={uploading || references.length >= 5} onChange={event => { void addFiles(event.target.files); event.target.value = '' }} />
              </label>
              <span className="composer-hint">{references.length}/5</span>
            </>}
            {kind === 'text' && <span className="composer-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>}
            <span className="spacer" />
            {busy && kind === 'text'
              ? <button className="btn btn-secondary btn-sm" onClick={stop}><Square size={12} /> Stop</button>
              : kind === 'text'
                ? <button className="btn btn-primary btn-icon" disabled={!prompt.trim()} onClick={() => void send(prompt)} aria-label="Send"><ArrowUp size={16} /></button>
                : <button className="btn btn-primary btn-sm" disabled={!prompt.trim() || busy || uploading} onClick={() => void send(prompt)}>{busy ? 'Sending…' : 'Generate'}</button>}
          </div>
        </div>
        {kind === 'text' && <p className="composer-hint thread-note">
          Each message is sent to {model?.provider} on its own. Earlier turns in this thread are not included as context.
        </p>}
      </div>
    </div>

    {preview && <PreviewPane generation={preview} onClose={() => setPreview(null)} onEdit={() => void editFrom(preview)} />}
  </div>
}

function ThreadTurn({ generation, modelName, onRetry, onPreview, onEdit }: {
  generation: ApiGeneration
  modelName: string
  onRetry: () => void
  onPreview: () => void
  onEdit: () => void
}) {
  const Icon = kindIcon[generation.kind]
  return <div className="turn">
    <div className="turn user"><div className="bubble-user">{generation.prompt}</div></div>
    <div className="turn">
      <div className="turn-head">
        <KindChip kind={generation.kind} size={20} />
        <strong>{modelName}</strong>
        {generation.status === 'queued' && <span className="spinner" />}
        <span className="spacer" />
        {generation.status === 'queued' && generation.queuedForMs ? <span>waiting {formatDuration(generation.queuedForMs)}</span> : null}
        {generation.providerLatencyMs ? <span>{formatDuration(generation.providerLatencyMs)}</span> : null}
      </div>

      {generation.status === 'failed' && <div className="turn-error">
        <X size={15} /><div><strong>Request failed</strong>{generationErrorMessage(generation.error || '')}</div>
      </div>}

      {generation.outputText && <div className="response">{generation.outputText}</div>}

      {generation.kind !== 'text' && generation.status !== 'failed' && <div className="thread-media">
        <button className="media-frame thread-frame" onClick={onPreview} disabled={!generation.resultUrl}>
          {generation.resultUrl
            ? generation.kind === 'image'
              ? <img src={generation.resultUrl} alt={generation.title} loading="lazy" />
              : <video src={generation.resultUrl} />
            : <div className="media-pending"><span className="spinner" /><Icon size={15} /> Working…</div>}
        </button>
      </div>}

      <div className="turn-actions">
        <button className="btn btn-ghost btn-sm" onClick={onRetry}><RotateCcw size={13} /> Retry</button>
        {generation.outputText && <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(generation.outputText!)}>Copy</button>}
        {generation.resultUrl && <>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={13} /> Use as reference</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void downloadResult(generation.resultUrl!, generation.id, generation.kind)}><Download size={13} /> Download</button>
        </>}
      </div>
    </div>
  </div>
}

function PreviewPane({ generation, onClose, onEdit }: { generation: ApiGeneration; onClose: () => void; onEdit: () => void }) {
  return <aside className="preview-pane">
    <div className="preview-head">
      <strong>Preview</strong>
      <span className="spacer" />
      <GenerationStatusBadge status={generation.status} />
      <button className="btn btn-icon" onClick={onClose} aria-label="Close preview"><X size={15} /></button>
    </div>
    <div className="preview-stage">
      {generation.kind === 'image'
        ? <img src={generation.resultUrl!} alt={generation.title} />
        : <video src={generation.resultUrl!} controls playsInline />}
    </div>
    <div className="preview-body">
      <p>{generation.prompt}</p>
      <dl className="preview-meta">
        <div><dt>Cost</dt><dd>{nanoMoney(generation.costNanoUsd)}</dd></div>
        <div><dt>Provider time</dt><dd>{formatDuration(generation.providerLatencyMs) || '—'}</dd></div>
        <div><dt>Created</dt><dd>{relativeTime(generation.createdAt)}</dd></div>
      </dl>
    </div>
    <div className="preview-foot">
      <button className="btn btn-secondary btn-sm" onClick={onEdit}><Pencil size={13} /> Use as reference</button>
      <button className="btn btn-ghost btn-sm" onClick={() => void downloadResult(generation.resultUrl!, generation.id, generation.kind)}><Download size={13} /> Download</button>
      <a className="btn btn-ghost btn-sm" href={generation.resultUrl!} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
    </div>
  </aside>
}

function Pill({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="option-pill">
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
    <ChevronDown size={12} />
  </label>
}

// A stopped stream still produced text; keep it visible without inventing a record.
function syntheticGeneration(partial: Pending, model: ModelView): ApiGeneration {
  return {
    id: `stopped-${partial.key}`,
    userEmail: '',
    title: partial.prompt.slice(0, 64),
    modelId: model.id,
    modelName: model.name,
    kind: 'text',
    prompt: partial.prompt,
    status: 'complete',
    costNanoUsd: 0,
    outputText: partial.response,
    createdAt: new Date().toISOString(),
  } as ApiGeneration
}

export type { ApiSession }
