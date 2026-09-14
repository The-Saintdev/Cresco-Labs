import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Download, ExternalLink, Info, Paperclip, RotateCcw, Square, X } from 'lucide-react'
import { generationErrorMessage, streamGeneration, submitGeneration, uploadReference, type ApiGeneration, type ApiUpload } from '../api'
import { Empty, GenerationStatusBadge, KindChip, Notice } from '../components'
import { cx, downloadResult, formatDuration, nanoMoney, relativeTime } from '../lib/format'
import { useWorkspace } from '../lib/store'
import { useRouter } from '../lib/router'

type Turn = {
  key: string
  prompt: string
  response: string
  status: 'streaming' | 'complete' | 'failed'
  error?: string
  generationId?: string
  latencyMs?: number | null
}

export default function ModelPage({ modelId }: { modelId: string }) {
  const { models, loading } = useWorkspace()
  const model = models.find(item => item.id === modelId)

  if (!model) {
    if (loading) return <div className="page" />
    return <div className="page"><Empty icon={Info} title="Model not found" text="This model may have been archived or is not available to your account." /></div>
  }
  if (model.state === 'setup') {
    return <div className="page"><Empty icon={Info} title={`${model.name} is not ready`} text="An administrator still needs to add a provider key or endpoint for this model." /></div>
  }
  return model.kind === 'text' ? <TextModel key={model.id} model={model} /> : <MediaModel key={model.id} model={model} />
}

/* --- text: a conversation surface ----------------------------------------- */

function TextModel({ model }: { model: ReturnType<typeof useWorkspace>['models'][number] }) {
  const { addGeneration, refresh } = useWorkspace()
  const [turns, setTurns] = useState<Turn[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns])

  const grow = useCallback(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`
  }, [])
  useEffect(grow, [prompt, grow])

  const send = async (text: string) => {
    const value = text.trim()
    if (!value || busy) return
    const key = `turn-${Date.now()}`
    setTurns(items => [...items, { key, prompt: value, response: '', status: 'streaming' }])
    setPrompt('')
    setBusy(true)
    const controller = new AbortController()
    abort.current = controller
    const update = (patch: Partial<Turn>) => setTurns(items => items.map(item => (item.key === key ? { ...item, ...patch } : item)))
    try {
      const final = await streamGeneration(model.id, value, {}, [], {
        onDelta: chunk => update({ response: (turnResponse(key) ?? '') + chunk }),
      }, controller.signal)
      update({ status: 'complete', response: final.outputText || '', generationId: final.id, latencyMs: final.providerLatencyMs })
      addGeneration(final)
      void refresh(true)
    } catch (reason) {
      if (controller.signal.aborted) update({ status: 'complete' })
      else update({ status: 'failed', error: reason instanceof Error ? reason.message : 'The request could not be sent.' })
    } finally {
      abort.current = null
      setBusy(false)
      box.current?.focus()
    }
  }

  // Reading the live value avoids a stale closure while deltas arrive fast.
  const turnsRef = useRef<Turn[]>([])
  turnsRef.current = turns
  function turnResponse(key: string) {
    return turnsRef.current.find(item => item.key === key)?.response
  }

  const stop = () => abort.current?.abort()

  return <div className="chat">
    <div className="chat-scroll">
      <div className="chat-inner">
        {!turns.length && <div className="chat-empty">
          <KindChip kind="text" size={38} />
          <h2>{model.name}</h2>
          <p>{model.blurb}</p>
          <div className="chat-suggestions">
            {['Summarise this in five bullets', 'Draft a short announcement', 'Explain this like I am new to it'].map(suggestion => (
              <button key={suggestion} onClick={() => { setPrompt(suggestion); box.current?.focus() }}>{suggestion}</button>
            ))}
          </div>
        </div>}

        {turns.map(turn => <div className="turn" key={turn.key}>
          <div className="turn user"><div className="bubble-user">{turn.prompt}</div></div>
          <div className="turn">
            <div className="turn-head">
              <KindChip kind="text" size={20} />
              <strong>{model.name}</strong>
              {turn.status === 'streaming' && <span className="spinner" />}
              <span className="spacer" />
              {turn.latencyMs ? <span>{formatDuration(turn.latencyMs)}</span> : null}
            </div>
            {turn.status === 'failed'
              ? <div className="turn-error"><X size={15} /><div><strong>Request failed</strong>{generationErrorMessage(turn.error || '')}</div></div>
              : <div className={cx('response', turn.status === 'streaming' && 'streaming')}>{turn.response}</div>}
            {turn.status !== 'streaming' && <div className="turn-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => void send(turn.prompt)}><RotateCcw size={13} /> Retry</button>
              {turn.response && <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(turn.response)}>Copy</button>}
            </div>}
          </div>
        </div>)}
        <div ref={bottom} />
      </div>
    </div>

    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={box}
          rows={1}
          value={prompt}
          placeholder={`Message ${model.name}…`}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send(prompt)
            }
          }}
        />
        <div className="composer-foot">
          <span className="composer-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <span className="spacer" />
          {busy
            ? <button className="btn btn-secondary btn-sm" onClick={stop}><Square size={12} /> Stop</button>
            : <button className="btn btn-primary btn-icon" disabled={!prompt.trim()} onClick={() => void send(prompt)} aria-label="Send"><ArrowUp size={16} /></button>}
        </div>
      </div>
      <p className="composer-hint" style={{ maxWidth: 'var(--measure)', margin: '8px auto 0', textAlign: 'center' }}>
        Each message is sent to {model.provider} on its own. Earlier turns are not included as context.
      </p>
    </div>
  </div>
}

/* --- image and video ------------------------------------------------------ */

function MediaModel({ model }: { model: ReturnType<typeof useWorkspace>['models'][number] }) {
  const { generations, addGeneration, refresh, toast } = useWorkspace()
  const { navigate } = useRouter()
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [quality, setQuality] = useState(model.kind === 'video' ? '720p' : 'Standard')
  const [duration, setDuration] = useState('10 seconds')
  const [references, setReferences] = useState<ApiUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mine = useMemo(() => generations.filter(item => item.modelId === model.id).slice(0, 24), [generations, model.id])

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

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true); setError('')
    try {
      const options = model.kind === 'video' ? { aspect, quality, duration } : { aspect, quality }
      const created = (await submitGeneration(model.id, prompt.trim(), options, references.map(item => item.id))).generation
      addGeneration(created)
      setPrompt(''); setReferences([])
      toast(created.status === 'complete' ? 'Result ready' : 'Sent to the provider')
      void refresh(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="chat">
    <div className="chat-scroll">
      <div className="page" style={{ paddingTop: 22 }}>
        <div className="page-head">
          <KindChip kind={model.kind} size={34} />
          <div>
            <h1>{model.name}</h1>
            <p>{model.provider} · {model.priceNanoUsd ? `${nanoMoney(model.priceNanoUsd)} per run` : 'cost tracked per run'}</p>
          </div>
        </div>
        {mine.length ? <div className="media-grid">
          {mine.map(item => <MediaResult key={item.id} generation={item} onOpen={() => navigate(`/g/${item.id}`)} />)}
        </div> : <Empty icon={KindChipIcon(model.kind)} title={`No ${model.kind}s yet`} text={`Describe what you want and ${model.name} will generate it below.`} />}
      </div>
    </div>

    <div className="composer-wrap">
      <div className="composer">
        <textarea
          rows={2}
          value={prompt}
          placeholder={model.kind === 'video' ? 'Describe the scene, action, camera and mood…' : 'Describe the subject, composition, light and style…'}
          onChange={event => setPrompt(event.target.value)}
        />
        <div className="option-row">
          <Pill value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '4:3']} />
          <Pill value={quality} onChange={setQuality} options={model.kind === 'video' ? ['480p', '720p', '1080p'] : ['Standard', 'High']} />
          {model.kind === 'video' && <Pill value={duration} onChange={setDuration} options={['5 seconds', '10 seconds', '15 seconds']} />}
        </div>
        {references.length > 0 && <div className="attachments">
          {references.map(reference => <div className="attachment" key={reference.id}>
            <span>{reference.fileName}</span>
            <button onClick={() => setReferences(items => items.filter(item => item.id !== reference.id))} aria-label={`Remove ${reference.fileName}`}><X size={12} /></button>
          </div>)}
        </div>}
        <div className="composer-foot">
          <label className="btn btn-ghost btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
            <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Reference'}
            <input type="file" multiple hidden accept={model.kind === 'video' ? 'image/*,video/*,audio/*' : 'image/*'} disabled={uploading || references.length >= 5} onChange={event => { void addFiles(event.target.files); event.target.value = '' }} />
          </label>
          <span className="composer-hint">{references.length}/5</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" disabled={!prompt.trim() || busy || uploading} onClick={() => void generate()}>
            {busy ? 'Sending…' : 'Generate'}
          </button>
        </div>
      </div>
      {error && <div style={{ maxWidth: 'var(--measure)', margin: '10px auto 0' }}><Notice tone="error">{error}</Notice></div>}
    </div>
  </div>
}

function MediaResult({ generation, onOpen }: { generation: ApiGeneration; onOpen: () => void }) {
  const waiting = generation.status === 'queued'
  return <div className="media-card">
    <button className="media-frame" onClick={onOpen} style={{ width: '100%' }}>
      {generation.resultUrl && generation.kind === 'image' && <img src={generation.resultUrl} alt={generation.title} loading="lazy" />}
      {generation.resultUrl && generation.kind === 'video' && <video src={generation.resultUrl} controls playsInline />}
      {!generation.resultUrl && <div className="media-pending">
        {waiting ? <><span className="spinner" />Working{generation.queuedForMs ? ` · ${formatDuration(generation.queuedForMs)}` : ''}</> : <>No result</>}
      </div>}
    </button>
    <div className="media-body">
      <p>{generation.prompt}</p>
      <div className="media-actions">
        <GenerationStatusBadge status={generation.status} />
        <span className="spacer" />
        <span className="row-meta">{relativeTime(generation.createdAt)}</span>
        {generation.resultUrl && <>
          <button className="btn btn-icon" title="Download" onClick={() => void downloadResult(generation.resultUrl!, generation.id, generation.kind)}><Download size={14} /></button>
          <a className="btn btn-icon" title="Open original" href={generation.resultUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>
        </>}
      </div>
    </div>
  </div>
}

function Pill({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="option-pill">
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
    <ChevronDown size={12} />
  </label>
}

function KindChipIcon(kind: 'text' | 'image' | 'video') {
  return kind === 'video' ? Info : Info
}
