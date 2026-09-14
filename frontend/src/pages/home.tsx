import { ArrowRight, Clock3, Sparkles } from 'lucide-react'
import { GenerationStatusBadge, KindChip, ModelStatusBadge, Empty } from '../components'
import { Link } from '../lib/router'
import { cx, nanoMoney, relativeTime } from '../lib/format'
import { useWorkspace, type ModelView } from '../lib/store'

export default function HomePage() {
  const { user, models, generations, loading } = useWorkspace()
  const usable = models.filter(model => model.state !== 'setup')
  const recent = generations.slice(0, 6)

  return <div className="page">
    <div className="page-head">
      <div>
        <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
        <p>{usable.length} of {models.length} models ready to use.</p>
      </div>
    </div>

    <section>
      <div className="section-head">
        <div><h2>Models</h2><p>Pick a model to start working.</p></div>
      </div>
      {loading && !models.length ? <div className="model-grid">{[0, 1, 2].map(index => <div key={index} className="model-card" style={{ opacity: 0.4 }} />)}</div>
        : models.length ? <div className="model-grid">{models.map(model => <ModelCard key={model.id} model={model} />)}</div>
        : <Empty icon={Sparkles} title="No models yet" text="An administrator adds models from the Cresco admin app. They appear here as soon as they are connected." />}
    </section>

    <section className="section">
      <div className="section-head">
        <div><h2>Recent</h2></div>
        <div className="spacer" />
        <Link className="btn btn-ghost btn-sm" to="/history">View all <ArrowRight size={13} /></Link>
      </div>
      {recent.length ? <div className="rows">
        {recent.map(item => <Link className="row" key={item.id} to={`/g/${item.id}`}>
          <KindChip kind={item.kind} />
          <div className="row-main">
            <strong>{item.title}</strong>
            <small>{item.modelName || item.modelId} · {item.prompt}</small>
          </div>
          <GenerationStatusBadge status={item.status} />
          <span className="row-meta">{relativeTime(item.createdAt)}</span>
        </Link>)}
      </div> : <Empty icon={Clock3} title="Nothing yet" text="Your generations will appear here once you run a model." />}
    </section>
  </div>
}

function ModelCard({ model }: { model: ModelView }) {
  const disabled = model.state === 'setup'
  const body = <>
    <div className="model-card-top">
      <KindChip kind={model.kind} />
      <div>
        <h3>{model.name}</h3>
        <small>{model.provider}</small>
      </div>
      <ModelStatusBadge state={model.state} />
    </div>
    <p>{model.blurb}</p>
    <div className="model-card-foot">
      <span className={cx('kind-dot', `kind-${model.kind}`)} />
      <span style={{ textTransform: 'capitalize' }}>{model.kind}</span>
      <span className="spacer" />
      <span>{model.priceNanoUsd ? `${nanoMoney(model.priceNanoUsd)} / run` : 'Cost tracked per run'}</span>
    </div>
  </>

  if (disabled) return <div className="model-card" aria-disabled="true" title="An administrator still needs to finish connecting this model">{body}</div>
  return <Link className="model-card" to={`/m/${model.id}`}>{body}</Link>
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
