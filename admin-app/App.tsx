import { useCallback, useEffect, useState } from 'react'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { VideoView, useVideoPlayer } from 'expo-video'
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, RefreshControl,
  SafeAreaView, ScrollView, StatusBar, Text, TouchableOpacity, View,
} from 'react-native'
import {
  ArrowDownToLine, Boxes, CreditCard, Gauge, KeyRound, ScrollText, ShieldCheck, Trash2, Users,
} from 'lucide-react-native'
import { elapsed, money, radius, relativeTime, space, type Theme } from '@cresco/mobile-shared/tokens'
import {
  clearMobileSession, createModel as apiCreateModel, createUser as apiCreateUser, deleteModel as apiDeleteModel,
  getAdminWorkspace, login as apiLogin, reconcileProviderData, restoreMobileSession, setProviderCredential,
  updateBudgetPolicy, updateModel as apiUpdateModel, updateUser as apiUpdateUser,
  type ApiBalance, type ApiGeneration, type ApiModel, type ApiProvider, type ApiUser,
  type AuditEvent, type BudgetPolicy, type TextApi, type ThinkingMode, type UsageSummary,
} from '@cresco/mobile-shared/api'
import { Button, Card, Choice, Empty, ErrorNote, Field, KindBadge, SectionTitle, StatusPill, sheet, useTheme, type Kind } from './ui'
import { ThemeProvider, useThemeChoice, type ThemeChoice } from './theme'

type Tab = 'models' | 'people' | 'usage' | 'activity'
type AdminData = {
  users: ApiUser[]
  models: ApiModel[]
  usage: UsageSummary
  events: AuditEvent[]
  balances: ApiBalance[]
  generations: ApiGeneration[]
  providers: ApiProvider[]
}

const emptyData: AdminData = {
  users: [], models: [], usage: { spendNanoUsd: 0, calls: 0, byModel: [], balances: [] },
  events: [], balances: [], generations: [], providers: [],
}

export default function App() {
  return <ThemeProvider><Admin /></ThemeProvider>
}

function Admin() {
  const theme = useTheme()
  const [restoring, setRestoring] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [tab, setTab] = useState<Tab>('models')
  const [data, setData] = useState<AdminData>(emptyData)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setData(await getAdminWorkspace() as AdminData)
  }, [])

  const pull = useCallback(async () => {
    setRefreshing(true)
    try { await refresh() } catch { /* keep the last good view */ }
    finally { setRefreshing(false) }
  }, [refresh])

  useEffect(() => {
    let alive = true
    restoreMobileSession()
      .then(async session => {
        if (!alive || !session) return
        await refresh()
        if (alive) setSignedIn(true)
      })
      .catch(() => void clearMobileSession())
      .finally(() => { if (alive) setRestoring(false) })
    return () => { alive = false }
  }, [refresh])

  if (restoring) {
    return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={theme.accent} />
    </SafeAreaView>
  }

  if (!signedIn) {
    return <SignIn onSignedIn={async (email, password) => {
      await apiLogin(email, password, 'admin-mobile')
      await refresh()
      setSignedIn(true)
    }} />
  }

  const titles: Record<Tab, string> = { models: 'Models', people: 'People', usage: 'Usage', activity: 'Activity' }
  const pending = data.users.filter(user => user.status === 'pending').length

  return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bg }]}>
    <StatusBar barStyle={theme.bg === '#ffffff' ? 'dark-content' : 'light-content'} />
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, flexDirection: 'row', alignItems: 'center' }}>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text, letterSpacing: -0.4 }}>{titles[tab]}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>Cresco administration</Text>
      </View>
      <ShieldCheck size={18} color={theme.accent} />
    </View>

    <ScrollView contentContainerStyle={sheet.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}>
      {error ? <View style={{ marginBottom: space.md }}><ErrorNote>{error}</ErrorNote></View> : null}
      {tab === 'models' && <ModelsTab data={data} theme={theme} refresh={refresh} onError={setError} />}
      {tab === 'people' && <PeopleTab users={data.users} theme={theme} refresh={refresh} onError={setError} />}
      {tab === 'usage' && <UsageTab data={data} theme={theme} refresh={refresh} onError={setError} />}
      {tab === 'activity' && <ActivityTab data={data} theme={theme} onSignOut={() => { void clearMobileSession(); setSignedIn(false) }} />}
    </ScrollView>

    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bgSubtle, paddingBottom: space.sm }}>
      {([['models', Boxes], ['people', Users], ['usage', Gauge], ['activity', ScrollText]] as const).map(([value, Icon]) => (
        <TouchableOpacity
          key={value}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === value }}
          onPress={() => { setTab(value); setError('') }}
          style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: space.sm }}
        >
          <View>
            <Icon size={19} color={tab === value ? theme.accent : theme.textFaint} />
            {value === 'people' && pending > 0 && <View style={{ position: 'absolute', top: -3, right: -6, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.warn }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: theme.bg }}>{pending}</Text>
            </View>}
          </View>
          <Text style={{ fontSize: 11, fontWeight: tab === value ? '600' : '400', color: tab === value ? theme.text : theme.textFaint }}>{titles[value]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </SafeAreaView>
}

/* --- models ---------------------------------------------------------------- */

function ModelsTab({ data, theme, refresh, onError }: { data: AdminData; theme: Theme; refresh: () => Promise<void>; onError: (message: string) => void }) {
  const [editingId, setEditingId] = useState('')
  const [kind, setKind] = useState<Kind>('text')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [price, setPrice] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [thinking, setThinking] = useState<ThinkingMode>('disabled')
  const [textApi, setTextApi] = useState<TextApi>('chat_completions')
  const [busy, setBusy] = useState(false)

  const [vaultProvider, setVaultProvider] = useState('')
  const [vaultKey, setVaultKey] = useState('')
  const [vaultBusy, setVaultBusy] = useState(false)

  const secured = data.providers.some(item => item.provider.trim().toLowerCase() === provider.trim().toLowerCase())
  const ready = Boolean(name.trim() && provider.trim() && endpoint.trim() && (editingId || apiKey.trim() || secured) && Number(price) >= 0)

  const clear = () => {
    setEditingId(''); setKind('text'); setName(''); setDescription(''); setProvider('')
    setEndpoint(''); setPrice(''); setApiKey(''); setThinking('disabled'); setTextApi('chat_completions')
  }

  const edit = (model: ApiModel) => {
    setEditingId(model.id)
    setKind(model.kind as Kind)
    setName(model.name)
    setDescription(model.description || '')
    setProvider(model.provider)
    setEndpoint(model.endpoint || '')
    setPrice(String(Number(model.priceNanoUsd || 0) / 1_000_000_000))
    setThinking(model.thinkingMode || 'disabled')
    setTextApi(model.textApi || 'chat_completions')
    setApiKey('')
  }

  const save = async () => {
    setBusy(true); onError('')
    try {
      const input = {
        name: name.trim(), description: description.trim(), provider: provider.trim(), endpoint: endpoint.trim(),
        apiKey: apiKey.trim() || undefined, priceUsd: Number(price), kind,
        ...(kind === 'text' ? { thinkingMode: thinking, textApi } : {}),
      }
      if (editingId) await apiUpdateModel(editingId, input)
      else await apiCreateModel({ ...input, status: 'active' })
      await refresh()
      clear()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'That model could not be saved.')
    } finally { setBusy(false) }
  }

  const toggle = async (model: ApiModel) => {
    onError('')
    try {
      await apiUpdateModel(model.id, { status: model.status === 'disabled' ? 'active' : 'disabled' })
      await refresh()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'That model could not be updated.')
    }
  }

  const archive = async (id: string) => {
    onError('')
    try { await apiDeleteModel(id); await refresh() }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'That model could not be archived.') }
  }

  const secure = async () => {
    if (!vaultProvider.trim() || !vaultKey.trim()) return
    setVaultBusy(true); onError('')
    try {
      await setProviderCredential(vaultProvider.trim(), vaultKey.trim())
      await refresh()
      setVaultKey('')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'That key could not be stored.')
    } finally { setVaultBusy(false) }
  }

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SectionTitle title="Provider keys" detail="Stored encrypted on the backend and never returned to any client." />
    {data.providers.map(item => <Card key={item.provider} style={{ padding: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <KeyRound size={16} color={theme.accent} />
      <View style={sheet.grow}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{item.provider}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>Secured · updated {relativeTime(item.updatedAt)}</Text>
      </View>
    </Card>)}
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Field label="Provider" value={vaultProvider} onChange={setVaultProvider} placeholder="fal.ai or BytePlus ModelArk" />
      <Field label="API key" value={vaultKey} onChange={setVaultKey} secure placeholder="Encrypted on the backend" />
      <Button label={vaultBusy ? 'Storing…' : 'Store key'} busy={vaultBusy} disabled={!vaultProvider.trim() || !vaultKey.trim()} onPress={secure} />
    </Card>

    <SectionTitle title={editingId ? 'Edit model' : 'Add a model'} detail="Members only ever see the name, kind and description." />
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Choice
        value={kind}
        onChange={setKind}
        options={[{ value: 'text', label: 'Text' }, { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }] as const}
      />
      <Field label="Name" value={name} onChange={setName} placeholder="GLM-5.3-Flash" />
      <Field label="Description" value={description} onChange={setDescription} placeholder="What members should use it for" />
      <Field label="Provider" value={provider} onChange={setProvider} placeholder="BytePlus ModelArk" hint={secured ? 'A key is already stored for this provider.' : 'Add a key below or store one above.'} />
      <Field label="Endpoint or model ID" value={endpoint} onChange={setEndpoint} placeholder="glm-5.3-flash" />
      <Field label="Price per run (USD)" value={price} onChange={setPrice} placeholder="0.0002" keyboard="decimal-pad" />

      {kind === 'text' && <>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted }}>Reasoning</Text>
          <Choice
            value={thinking}
            onChange={setThinking}
            options={[{ value: 'disabled', label: 'Off' }, { value: 'enabled', label: 'On' }, { value: 'auto', label: 'Provider' }] as const}
          />
          <Text style={{ fontSize: 12, color: theme.textFaint }}>Reasoning adds latency and billed tokens. Leave it off unless this model needs it.</Text>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted }}>Text endpoint</Text>
          <Choice
            value={textApi}
            onChange={setTextApi}
            options={[{ value: 'chat_completions', label: 'Chat completions' }, { value: 'responses', label: 'Responses' }] as const}
          />
          <Text style={{ fontSize: 12, color: theme.textFaint }}>Chat completions is standard. Switch only to compare latency.</Text>
        </View>
      </>}

      <Field label={editingId ? 'Replace API key (optional)' : 'API key'} value={apiKey} onChange={setApiKey} secure placeholder={secured ? 'Using the stored provider key' : 'Encrypted on the backend'} />
      <Button label={busy ? 'Saving…' : editingId ? 'Save changes' : 'Add model'} busy={busy} disabled={!ready} onPress={save} />
      {editingId ? <Button label="Cancel" tone="secondary" onPress={clear} /> : null}
    </Card>

    <SectionTitle title="Connected models" detail={`${data.models.filter(item => item.executionReady).length} ready of ${data.models.length}`} />
    {data.models.map(model => <Card key={model.id} style={{ padding: space.lg, marginBottom: space.sm, gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <KindBadge kind={model.kind as Kind} size={30} />
        <View style={sheet.grow}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{model.name}</Text>
          <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
            {model.provider} · {model.status}{model.priceNanoUsd ? ` · ${money(model.priceNanoUsd)}/run` : ''}
          </Text>
          {model.kind === 'text' && <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
            reasoning {model.thinkingMode || 'disabled'} · {(model.textApi || 'chat_completions') === 'responses' ? 'responses' : 'chat completions'}
          </Text>}
        </View>
        <Text style={{ fontSize: 11, fontWeight: '600', color: model.executionReady ? theme.success : theme.warn }}>
          {model.executionReady ? 'Ready' : model.credentialConfigured ? 'Adapter' : 'Key'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Edit" tone="secondary" onPress={() => edit(model)} style={{ flex: 1 }} />
        <Button label={model.status === 'disabled' ? 'Publish' : 'Disable'} tone="secondary" onPress={() => void toggle(model)} style={{ flex: 1 }} />
        <TouchableOpacity
          accessibilityLabel={`Archive ${model.name}`}
          onPress={() => void archive(model.id)}
          style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: theme.dangerWeak }}
        >
          <Trash2 size={16} color={theme.danger} />
        </TouchableOpacity>
      </View>
    </Card>)}
    {!data.models.length && <Empty title="No models yet" text="Add one above and it appears in the member apps immediately." />}
  </KeyboardAvoidingView>
}

/* --- people ---------------------------------------------------------------- */

function PeopleTab({ users, theme, refresh, onError }: { users: ApiUser[]; theme: Theme; refresh: () => Promise<void>; onError: (message: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true); onError('')
    try {
      await apiCreateUser({ name: name.trim(), email: email.trim(), password, role, status: 'active' })
      await refresh()
      setName(''); setEmail(''); setPassword(''); setRole('member')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'That account could not be created.')
    } finally { setBusy(false) }
  }

  const setStatus = async (user: ApiUser, status: 'active' | 'suspended') => {
    onError('')
    try { await apiUpdateUser(user.id, { status }); await refresh() }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'That account could not be updated.') }
  }

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SectionTitle title="Invite someone" detail="Members cannot sign themselves up. Every account is created here." />
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Field label="Full name" value={name} onChange={setName} placeholder="Jamie Rivera" />
      <Field label="Email" value={email} onChange={setEmail} placeholder="jamie@company.com" keyboard="email-address" />
      <Field label="Temporary password" value={password} onChange={setPassword} secure hint="At least 10 characters. They can change it after signing in." />
      <Choice value={role} onChange={setRole} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Administrator' }] as const} />
      <Button label={busy ? 'Creating…' : 'Create account'} busy={busy} disabled={!name.trim() || !email.trim() || password.length < 10} onPress={create} />
    </Card>

    <SectionTitle title="Team" detail={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`} />
    {users.map(user => <Card key={user.id} style={{ padding: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: theme.accentWeak, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.accent }}>{user.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</Text>
      </View>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{user.name}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{user.email} · {user.role} · {user.status}</Text>
      </View>
      <Button
        label={user.status === 'active' ? 'Suspend' : 'Activate'}
        tone={user.status === 'active' ? 'danger' : 'secondary'}
        onPress={() => void setStatus(user, user.status === 'active' ? 'suspended' : 'active')}
      />
    </Card>)}
  </KeyboardAvoidingView>
}

/* --- usage ----------------------------------------------------------------- */

function UsageTab({ data, theme, refresh, onError }: { data: AdminData; theme: Theme; refresh: () => Promise<void>; onError: (message: string) => void }) {
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')
  const limit = Number(data.usage.budget?.workspaceMonthlyLimitNanoUsd || 0)
  const committed = Number(data.usage.monthlyCommittedNanoUsd || 0)
  const percent = limit > 0 ? Math.min(100, Math.round((committed / limit) * 100)) : 0

  const sync = async () => {
    setSyncing(true); setNote(''); onError('')
    try {
      const result = await reconcileProviderData()
      await refresh()
      setNote(result.providerSync.configured
        ? `Reconciled ${result.providerSync.reconciledCosts || 0} exact costs and refreshed the balance.`
        : 'Add a fal.ai key to enable provider billing sync.')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Provider data could not be synced.')
    } finally { setSyncing(false) }
  }

  return <View>
    <Card style={{ padding: space.lg }}>
      <Text style={{ fontSize: 12, color: theme.textFaint }}>Tracked spend</Text>
      <Text style={{ fontSize: 30, fontWeight: '700', color: theme.text, marginVertical: 6, letterSpacing: -0.6 }}>{money(data.usage.spendNanoUsd)}</Text>
      <Text style={{ fontSize: 12, color: theme.textFaint }}>{data.usage.calls.toLocaleString()} generations · {data.users.length} members</Text>
    </Card>

    {limit > 0 && <Card style={{ padding: space.lg, marginTop: space.sm }}>
      <View style={sheet.rowBetween}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text, flex: 1 }}>Monthly budget</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint }}>{money(committed)} / {money(limit)}</Text>
      </View>
      <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: theme.bgSunken, marginTop: space.md, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: percent >= 100 ? theme.danger : percent >= 80 ? theme.warn : theme.accent }} />
      </View>
    </Card>}

    <View style={{ marginTop: space.md }}>
      <Button label={syncing ? 'Syncing…' : 'Sync provider billing'} busy={syncing} tone="secondary" onPress={sync} />
      {note ? <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: space.sm }}>{note}</Text> : null}
    </View>

    <BudgetEditor policy={data.usage.budget} theme={theme} refresh={refresh} onError={onError} />

    <SectionTitle title="Balances" />
    {data.balances.map(balance => <Card key={balance.provider} style={{ padding: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center' }}>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{balance.provider}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{balance.source === 'provider' ? 'Live balance' : 'Internal ledger'}</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{money(balance.amountNanoUsd)}</Text>
    </Card>)}

    <SectionTitle title="Spend by model" />
    {data.usage.byModel.map(item => <Card key={item.modelId} style={{ padding: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center' }}>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{item.name}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{item.provider} · {item.calls} runs</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{money(item.spendNanoUsd)}</Text>
    </Card>)}

    <SectionTitle title="Add credit" detail="Payment always happens in the provider's own console." />
    {[['fal.ai', 'https://fal.ai/dashboard/billing'], ['BytePlus', 'https://console.byteplus.com/finance']].map(([label, href]) => (
      <TouchableOpacity key={label} onPress={() => void Linking.openURL(href)}>
        <Card style={{ padding: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <CreditCard size={16} color={theme.accent} />
          <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: theme.text }}>Open the {label} billing console</Text>
        </Card>
      </TouchableOpacity>
    ))}
  </View>
}

function BudgetEditor({ policy, theme, refresh, onError }: { policy?: BudgetPolicy; theme: Theme; refresh: () => Promise<void>; onError: (message: string) => void }) {
  const [monthly, setMonthly] = useState(String(Number(policy?.workspaceMonthlyLimitNanoUsd || 0) / 1_000_000_000))
  const [perRun, setPerRun] = useState(String(Number(policy?.perGenerationLimitNanoUsd || 0) / 1_000_000_000))
  const [warn, setWarn] = useState(String(policy?.warnAtPercent || 80))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true); onError('')
    try {
      await updateBudgetPolicy({ workspaceMonthlyLimitUsd: Number(monthly) || 0, perGenerationLimitUsd: Number(perRun) || 0, warnAtPercent: Number(warn) || 80 })
      await refresh()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'The budget could not be saved.')
    } finally { setBusy(false) }
  }

  return <>
    <SectionTitle title="Limits" detail="Zero means no hard cap. Requests above a limit are rejected before dispatch." />
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Field label="Monthly workspace limit (USD)" value={monthly} onChange={setMonthly} keyboard="decimal-pad" />
      <Field label="Per generation limit (USD)" value={perRun} onChange={setPerRun} keyboard="decimal-pad" />
      <Field label="Warn at (%)" value={warn} onChange={setWarn} keyboard="decimal-pad" />
      <Button label={busy ? 'Saving…' : 'Save limits'} busy={busy} onPress={save} />
      <Text style={{ fontSize: 12, color: theme.textFaint }}>Applies to every member immediately.</Text>
    </Card>
  </>
}

/* --- activity -------------------------------------------------------------- */

function ActivityTab({ data, theme, onSignOut }: { data: AdminData; theme: Theme; onSignOut: () => void }) {
  const { choice, setChoice } = useThemeChoice()
  const [openId, setOpenId] = useState<string | null>(null)

  return <View>
    <SectionTitle title="Generations" detail="Every member request, its prompt and its result." />
    {data.generations.slice(0, 40).map(item => {
      const open = openId === item.id
      return <Card key={item.id} style={{ padding: space.lg, marginBottom: space.sm, gap: space.sm }}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => setOpenId(value => (value === item.id ? null : item.id))} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <KindBadge kind={item.kind as Kind} size={30} />
          <View style={sheet.grow}>
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{item.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
              {item.userEmail} · {money(item.costNanoUsd)} · {relativeTime(item.createdAt)}
              {item.providerLatencyMs ? ` · ${elapsed(item.providerLatencyMs)}` : ''}
            </Text>
          </View>
          <StatusPill status={item.status} />
        </TouchableOpacity>
        {open && <View style={{ gap: space.sm }}>
          <Text style={{ fontSize: 13, color: theme.textMuted, lineHeight: 20 }}>{item.prompt}</Text>
          {item.error ? <ErrorNote>{item.error}</ErrorNote> : null}
          {item.outputText ? <Text selectable style={{ fontSize: 14, color: theme.text, lineHeight: 22 }}>{item.outputText}</Text> : null}
          {item.resultUrl ? <AdminResult generation={item} theme={theme} /> : null}
        </View>}
      </Card>
    })}
    {!data.generations.length && <Empty title="Nothing yet" text="Member generations appear here as they run." />}

    <SectionTitle title="Audit log" />
    {data.events.slice(0, 30).map(event => <Card key={event.id} style={{ padding: space.lg, marginBottom: space.sm }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>{event.action}</Text>
      <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{event.actorEmail || 'system'} · {relativeTime(event.createdAt)}</Text>
    </Card>)}

    <SectionTitle title="Appearance" detail="Applies to this device." />
    <Card style={{ padding: space.lg }}>
      <Choice
        value={choice}
        onChange={value => setChoice(value as ThemeChoice)}
        options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const}
      />
    </Card>

    <View style={{ marginTop: space.lg }}>
      <Button label="Sign out" tone="danger" onPress={onSignOut} />
    </View>
  </View>
}

function AdminResult({ generation, theme }: { generation: ApiGeneration; theme: Theme }) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const save = async () => {
    if (!generation.resultUrl) return
    setSaving(true); setSaveError('')
    try {
      const extension = generation.resultUrl.split('?')[0].split('.').pop()?.slice(0, 5) || (generation.kind === 'video' ? 'mp4' : 'png')
      const downloaded = await FileSystem.downloadAsync(generation.resultUrl, `${FileSystem.cacheDirectory}cresco-${generation.id}.${extension}`)
      if (!(await Sharing.isAvailableAsync())) throw new Error('Saving is not available on this device.')
      await Sharing.shareAsync(downloaded.uri, { dialogTitle: 'Save Cresco result' })
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'That result could not be saved.')
    } finally { setSaving(false) }
  }
  return <View style={{ gap: space.sm }}>
    {generation.kind === 'image'
      ? <Image source={{ uri: generation.resultUrl! }} resizeMode="contain" style={{ width: '100%', height: 260, borderRadius: radius.md, backgroundColor: theme.bgSunken }} />
      : <AdminVideo url={generation.resultUrl!} background={theme.bgSunken} />}
    {saveError ? <ErrorNote>{saveError}</ErrorNote> : null}
    <Button label={saving ? 'Preparing…' : 'Save'} tone="secondary" icon={ArrowDownToLine} busy={saving} onPress={save} />
  </View>
}

function AdminVideo({ url, background }: { url: string; background: string }) {
  const player = useVideoPlayer(url, instance => { instance.loop = false })
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: background }} />
}

/* --- sign in --------------------------------------------------------------- */

function SignIn({ onSignedIn }: { onSignedIn: (email: string, password: string) => Promise<void> }) {
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true); setError('')
    try { await onSignedIn(email.trim(), password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }

  return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bgSubtle }]}>
    <KeyboardAvoidingView style={[sheet.screen, { justifyContent: 'center', padding: space.xl }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ShieldCheck size={22} color={theme.accent} />
      <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text, marginTop: space.md, letterSpacing: -0.4 }}>Cresco admin</Text>
      <Text style={{ fontSize: 14, color: theme.textMuted, marginTop: 6, marginBottom: space.xl }}>Administrator access only.</Text>
      <View style={{ gap: space.md }}>
        <Field label="Email" value={email} onChange={setEmail} placeholder="admin@company.com" keyboard="email-address" />
        <Field label="Password" value={password} onChange={setPassword} secure />
      </View>
      {error ? <View style={{ marginTop: space.lg }}><ErrorNote>{error}</ErrorNote></View> : null}
      <Button label={busy ? 'Signing in…' : 'Sign in'} busy={busy} disabled={!email.trim() || !password} onPress={submit} style={{ marginTop: space.xl }} />
    </KeyboardAvoidingView>
  </SafeAreaView>
}
