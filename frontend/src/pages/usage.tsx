import { Wallet } from 'lucide-react'
import { Empty, KindChip, Meter, Stat } from '../components'
import { nanoMoney } from '../lib/format'
import { useWorkspace, type Kind } from '../lib/store'

export default function UsagePage() {
  const { models, usage, balances } = useWorkspace()
  const spend = Number(usage?.spendNanoUsd || 0)
  const limit = Number(usage?.budget?.workspaceMonthlyLimitNanoUsd || 0)
  const committed = Number(usage?.monthlyCommittedNanoUsd || 0)
  const percent = limit > 0 ? (committed / limit) * 100 : 0
  const creditTotal = balances.reduce((sum, balance) => sum + Number(balance.amountNanoUsd || 0), 0)

  return <div className="page">
    <div className="page-head">
      <div><h1>Usage</h1><p>What the workspace has spent, and what is left.</p></div>
    </div>

    <div className="stat-grid">
      <Stat label="Tracked spend" value={nanoMoney(spend)} detail="Across recorded generations" />
      <Stat label="Credits remaining" value={nanoMoney(creditTotal)} detail="Provider and internal ledgers" />
      <Stat label="Generations" value={Number(usage?.calls || 0).toLocaleString()} detail={`Across ${models.length} models`} />
      <Stat label="This month" value={nanoMoney(committed)} detail={limit > 0 ? `of ${nanoMoney(limit)} budget` : 'No budget set'} />
    </div>

    {limit > 0 && <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-body">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 13 }}>Monthly budget</strong>
          <span className="row-meta">{Math.max(0, Math.round(100 - percent))}% remaining</span>
          <span className="spacer" style={{ marginLeft: 'auto' }} />
          <span className="row-meta">{nanoMoney(committed)} / {nanoMoney(limit)}</span>
        </div>
        <Meter percent={percent} />
      </div>
    </div>}

    <section className="section">
      <div className="section-head"><div><h2>By model</h2><p>Provider-confirmed costs replace estimates after reconciliation.</p></div></div>
      {usage?.byModel.length ? <div className="rows">
        <div className="row-head"><span style={{ flex: 1 }}>Model</span><span style={{ width: 70, textAlign: 'right' }}>Runs</span><span style={{ width: 82, textAlign: 'right' }}>Spend</span><span style={{ width: 96 }}>Share</span></div>
        {usage.byModel.map(item => {
          const model = models.find(entry => entry.id === item.modelId)
          const itemSpend = Number(item.spendNanoUsd || 0)
          const share = spend > 0 ? (itemSpend / spend) * 100 : 0
          return <div className="row" key={item.modelId}>
            <KindChip kind={(model?.kind || 'text') as Kind} />
            <div className="row-main"><strong>{item.name}</strong><small>{item.provider}{model ? '' : ' · archived'}</small></div>
            <span className="row-meta" style={{ width: 70, textAlign: 'right' }}>{item.calls.toLocaleString()}</span>
            <span className="row-meta" style={{ width: 82, textAlign: 'right', color: 'var(--text)' }}>{nanoMoney(itemSpend)}</span>
            <div style={{ width: 96 }}><Meter percent={share} /></div>
          </div>
        })}
      </div> : <Empty icon={Wallet} title="No spend yet" text="Usage appears here after the first generation completes." />}
    </section>

    {usage?.providerUsage && <section className="section">
      <div className="section-head"><div><h2>Provider account</h2><p>Account-wide billing, which can include usage outside Cresco.</p></div></div>
      <div className="rows">
        <div className="row-head"><span style={{ flex: 1 }}>Endpoint</span><span style={{ width: 80, textAlign: 'right' }}>Units</span><span style={{ width: 82, textAlign: 'right' }}>Spend</span></div>
        {usage.providerUsage.byEndpoint.map(item => <div className="row" key={`${item.provider}:${item.endpointId}`}>
          <div className="row-main"><strong>{item.endpointId}</strong><small>{item.provider}</small></div>
          <span className="row-meta" style={{ width: 80, textAlign: 'right' }}>{item.quantity.toLocaleString()}</span>
          <span className="row-meta" style={{ width: 82, textAlign: 'right', color: 'var(--text)' }}>{nanoMoney(item.spendNanoUsd)}</span>
        </div>)}
      </div>
    </section>}

    <section className="section">
      <div className="section-head"><div><h2>Provider balances</h2></div></div>
      <div className="rows">
        {balances.map(balance => <div className="row" key={balance.provider}>
          <div className="row-main"><strong>{balance.provider}</strong><small>{balance.source === 'provider' ? 'Live provider balance' : 'Internal ledger'}</small></div>
          <span className="row-meta" style={{ color: 'var(--text)' }}>{nanoMoney(balance.amountNanoUsd)}</span>
        </div>)}
        {!balances.length && <div className="palette-empty">No provider balances recorded yet.</div>}
      </div>
    </section>
  </div>
}
