import { useMemo, useState } from 'react'
import { Download, ExternalLink, Search, SlidersHorizontal } from 'lucide-react'
import { Empty, GenerationStatusBadge, KindChip, Segmented } from '../components'
import { Link } from '../lib/router'
import { downloadResult, formatDate, formatDuration, nanoMoney, relativeTime } from '../lib/format'
import { generationErrorMessage } from '../api'
import { useWorkspace, type Kind } from '../lib/store'

type KindFilter = 'all' | Kind

export default function HistoryPage() {
  const { generations } = useWorkspace()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [days, setDays] = useState('30')

  const filtered = useMemo(() => {
    const cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000
    const needle = query.trim().toLowerCase()
    return generations.filter(item => {
      if (kind !== 'all' && item.kind !== kind) return false
      if (new Date(item.createdAt).getTime() < cutoff) return false
      if (!needle) return true
      return [item.title, item.prompt, item.modelName, item.outputText].join(' ').toLowerCase().includes(needle)
    })
  }, [generations, kind, days, query])

  return <div className="page">
    <div className="page-head">
      <div><h1>History</h1><p>Every generation you have run, with its prompt and result.</p></div>
    </div>

    <div className="toolbar">
      <div className="search-inline">
        <Search size={14} />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search prompts and results" />
      </div>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[{ value: 'all', label: 'All' }, { value: 'text', label: 'Text' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }] as const}
      />
      <label className="btn btn-secondary btn-sm" style={{ gap: 6 }}>
        <SlidersHorizontal size={13} />
        <select value={days} onChange={event => setDays(event.target.value)} style={{ border: 0, background: 'none', outline: 'none', cursor: 'pointer' }}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </label>
      <span className="spacer" />
      <span className="row-meta">{filtered.length} of {generations.length}</span>
    </div>

    {filtered.length ? <div className="rows">
      {filtered.map(item => <Link className="row" key={item.id} to={`/g/${item.id}`}>
        <KindChip kind={item.kind} />
        <div className="row-main">
          <strong>{item.title}</strong>
          <small>{item.modelName || item.modelId} · {item.prompt}</small>
        </div>
        <GenerationStatusBadge status={item.status} />
        <span className="row-meta" style={{ width: 62, textAlign: 'right' }}>{nanoMoney(item.costNanoUsd)}</span>
        <span className="row-meta" style={{ width: 82, textAlign: 'right' }}>{relativeTime(item.createdAt)}</span>
      </Link>)}
    </div> : <Empty icon={Search} title="Nothing matches" text="Try a different search term, content type or time range." />}
  </div>
}

export function GenerationPage({ generationId }: { generationId: string }) {
  const { generations } = useWorkspace()
  const item = generations.find(entry => entry.id === generationId)

  if (!item) return <div className="page"><Empty icon={Search} title="Generation not found" text="It may have been removed, or it belongs to another member." /></div>

  return <div className="page" style={{ maxWidth: 780 }}>
    <div className="page-head">
      <KindChip kind={item.kind} size={34} />
      <div>
        <h1>{item.title}</h1>
        <p>{item.modelName || item.modelId} · {formatDate(item.createdAt)}</p>
      </div>
      <div className="page-head-actions"><GenerationStatusBadge status={item.status} /></div>
    </div>

    <div className="stat-grid" style={{ marginBottom: 20 }}>
      <Stat label="Cost" value={nanoMoney(item.costNanoUsd)} detail={item.costSource === 'provider' ? 'Provider confirmed' : item.costSource === 'catalog_estimate' ? 'Catalog estimate' : 'Pending reconciliation'} />
      <Stat label="Provider time" value={formatDuration(item.providerLatencyMs) || '—'} detail="Time spent at the provider" />
      <Stat label="Status" value={item.status === 'queued' ? 'Running' : item.status === 'complete' ? 'Complete' : 'Failed'} detail={item.status === 'queued' && item.queuedForMs ? `Waiting ${formatDuration(item.queuedForMs)}` : item.completedAt ? relativeTime(item.completedAt) : ''} />
    </div>

    <div className="panel">
      <div className="panel-head"><h2>Prompt</h2></div>
      <div className="panel-body"><div className="response">{item.prompt}</div></div>
    </div>

    {item.error && <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head"><h2>Error</h2></div>
      <div className="panel-body"><div className="turn-error">{generationErrorMessage(item.error)}</div></div>
    </div>}

    {item.outputText && <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head"><h2>Response</h2></div>
      <div className="panel-body"><div className="response">{item.outputText}</div></div>
    </div>}

    {item.resultUrl && <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head"><h2>Result</h2></div>
      <div className="media-frame" style={{ aspectRatio: 'auto', maxHeight: 520 }}>
        {item.kind === 'image' ? <img src={item.resultUrl} alt={item.title} /> : <video src={item.resultUrl} controls playsInline />}
      </div>
      <div className="panel-foot">
        <button className="btn btn-secondary btn-sm" onClick={() => void downloadResult(item.resultUrl!, item.id, item.kind)}><Download size={13} /> Download</button>
        <a className="btn btn-ghost btn-sm" href={item.resultUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open original</a>
      </div>
    </div>}

    {item.references && item.references.length > 0 && <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-head"><h2>References</h2></div>
      <div className="panel-body">
        <div className="attachments">{item.references.map(reference => <span className="attachment" key={reference.id}><span>{reference.fileName}</span></span>)}</div>
      </div>
    </div>}
  </div>
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}
