import { useCallback, useEffect, useMemo, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { VideoView, useVideoPlayer } from 'expo-video'
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, RefreshControl, SafeAreaView,
  ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { ArrowDownToLine, ChevronLeft, Gauge, LayoutGrid, MessageSquare, Paperclip, Plus, Send, Settings as SettingsIcon, Trash2, X } from 'lucide-react-native'
import { elapsed, kindColor, money, radius, relativeTime, space, type Theme } from '@cresco/mobile-shared/tokens'
import {
  archiveSession, clearMobileSession, getGeneration, getMemberWorkspace, getSession, listSessions,
  login as apiLogin, restoreMobileSession, submitGeneration, uploadMobileReference,
  type ApiGeneration, type ApiModel, type ApiSession, type ApiUpload, type UsageSummary,
} from '@cresco/mobile-shared/api'
import { Button, Card, Empty, ErrorNote, KindBadge, StatusPill, sheet, useTheme, type Kind } from './ui'
import { ThemeProvider, useThemeChoice, type ThemeChoice } from './theme'

type Tab = 'models' | 'chats' | 'usage' | 'settings'
type OpenThread = { model: ApiModel; sessionId?: string }

const emptyUsage: UsageSummary = { spendNanoUsd: 0, calls: 0, byModel: [], balances: [] }

export default function App() {
  return <ThemeProvider><Workspace /></ThemeProvider>
}

function Workspace() {
  const theme = useTheme()
  const [restoring, setRestoring] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<Tab>('models')
  const [models, setModels] = useState<ApiModel[]>([])
  const [history, setHistory] = useState<ApiGeneration[]>([])
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage)
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [open, setOpen] = useState<OpenThread | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    const [data, threads] = await Promise.all([getMemberWorkspace(), listSessions().catch(() => ({ sessions: [] }))])
    setModels(data.models)
    setHistory(data.generations)
    setUsage(data.usage)
    setSessions(threads.sessions)
  }, [])

  const pull = useCallback(async () => {
    setRefreshing(true)
    try { await refresh() } catch { /* keep showing what we already have */ }
    finally { setRefreshing(false) }
  }, [refresh])

  // Reads advance queued jobs on the server, so polling here both refreshes the
  // list and moves the work along.
  const waiting = history.some(item => item.status === 'queued')
  useEffect(() => {
    if (!signedIn || !waiting) return
    const timer = setInterval(() => void refresh().catch(() => undefined), 4000)
    return () => clearInterval(timer)
  }, [signedIn, waiting, refresh])

  useEffect(() => {
    let active = true
    restoreMobileSession()
      .then(async session => {
        if (!active || !session) return
        await refresh()
        if (!active) return
        setName(session.user.name)
        setSignedIn(true)
      })
      .catch(() => void clearMobileSession())
      .finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [refresh])

  if (restoring) {
    return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={theme.accent} />
    </SafeAreaView>
  }

  if (!signedIn) {
    return <SignIn onSignedIn={async (email, password) => {
      const session = await apiLogin(email, password, 'team-mobile')
      await refresh()
      setName(session.user.name)
      setSignedIn(true)
    }} />
  }

  if (open) {
    return <ThreadScreen
      key={open.sessionId || `new-${open.model.id}`}
      model={open.model}
      sessionId={open.sessionId}
      onBack={() => setOpen(null)}
      onNew={() => setOpen({ model: open.model })}
      onCreated={generation => setHistory(items => [generation, ...items.filter(item => item.id !== generation.id)])}
      onRefresh={refresh}
    />
  }

  const titles: Record<Tab, string> = { models: 'Models', chats: 'Chats', usage: 'Usage', settings: 'Settings' }

  return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bg }]}>
    <StatusBar barStyle={theme.bg === '#ffffff' ? 'dark-content' : 'light-content'} />
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text, letterSpacing: -0.4 }}>{titles[tab]}</Text>
      {tab === 'models' && <Text style={{ fontSize: 13, color: theme.textFaint, marginTop: 2 }}>Signed in as {name}</Text>}
    </View>

    <ScrollView
      contentContainerStyle={sheet.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
    >
      {tab === 'models' && <ModelList models={models} onOpen={model => setOpen({ model })} theme={theme} />}
      {tab === 'chats' && <ChatList
        sessions={sessions}
        models={models}
        theme={theme}
        onOpen={(model, sessionId) => setOpen({ model, sessionId })}
        onArchive={id => { setSessions(items => items.filter(item => item.id !== id)); void archiveSession(id).catch(() => undefined) }}
      />}
      {tab === 'usage' && <UsageView usage={usage} theme={theme} />}
      {tab === 'settings' && <SettingsView name={name} theme={theme} onSignOut={() => { void clearMobileSession(); setSignedIn(false); setTab('models') }} />}
    </ScrollView>

    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bgSubtle, paddingBottom: space.sm }}>
      {([['models', LayoutGrid], ['chats', MessageSquare], ['usage', Gauge], ['settings', SettingsIcon]] as const).map(([value, Icon]) => (
        <TouchableOpacity
          key={value}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === value }}
          onPress={() => setTab(value)}
          style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: space.sm }}
        >
          <Icon size={19} color={tab === value ? theme.accent : theme.textFaint} />
          <Text style={{ fontSize: 11, fontWeight: tab === value ? '600' : '400', color: tab === value ? theme.text : theme.textFaint }}>{titles[value]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </SafeAreaView>
}

function ModelList({ models, onOpen, theme }: { models: ApiModel[]; onOpen: (model: ApiModel) => void; theme: Theme }) {
  if (!models.length) return <Empty title="No models yet" text="An administrator connects models from the Cresco admin app. They appear here straight away." />
  return <View style={{ gap: space.sm }}>
    {models.map(model => {
      const ready = Boolean(model.executionReady)
      return <TouchableOpacity key={model.id} disabled={!ready} activeOpacity={0.8} onPress={() => onOpen(model)}>
        <Card style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: ready ? 1 : 0.55 }}>
          <KindBadge kind={model.kind as Kind} />
          <View style={sheet.grow}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>{model.name}</Text>
            <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
              {model.provider} · {ready ? (model.priceNanoUsd ? `${money(model.priceNanoUsd)} per run` : 'cost tracked per run') : 'setup needed'}
            </Text>
          </View>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: kindColor(theme, model.kind as Kind) }} />
        </Card>
      </TouchableOpacity>
    })}
  </View>
}

function ChatList({ sessions, models, theme, onOpen, onArchive }: {
  sessions: ApiSession[]
  models: ApiModel[]
  theme: Theme
  onOpen: (model: ApiModel, sessionId: string) => void
  onArchive: (id: string) => void
}) {
  if (!sessions.length) return <Empty title="No chats yet" text="Start one from the Models tab. Each chat keeps its own history." />
  return <View style={{ gap: space.sm }}>
    {sessions.map(item => {
      const model = models.find(entry => entry.id === item.modelId)
      if (!model) return null
      return <Card key={item.id} style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => onOpen(model, item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 }}>
          <KindBadge kind={model.kind as Kind} size={30} />
          <View style={sheet.grow}>
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{item.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>
              {model.name} · {item.generationCount || 0} {item.generationCount === 1 ? 'run' : 'runs'} · {relativeTime(item.updatedAt)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel={`Remove ${item.title}`} onPress={() => onArchive(item.id)} style={{ padding: space.sm }}>
          <Trash2 size={15} color={theme.textFaint} />
        </TouchableOpacity>
      </Card>
    })}
  </View>
}

function UsageView({ usage, theme }: { usage: UsageSummary; theme: Theme }) {
  const limit = Number(usage.budget?.workspaceMonthlyLimitNanoUsd || 0)
  const committed = Number(usage.monthlyCommittedNanoUsd || 0)
  const percent = limit > 0 ? Math.min(100, Math.round((committed / limit) * 100)) : 0
  return <View style={{ gap: space.sm }}>
    <Card style={{ padding: space.lg }}>
      <Text style={{ fontSize: 12, color: theme.textFaint }}>Tracked team spend</Text>
      <Text style={{ fontSize: 30, fontWeight: '700', color: theme.text, marginVertical: 6, letterSpacing: -0.6 }}>{money(usage.spendNanoUsd)}</Text>
      <Text style={{ fontSize: 12, color: theme.textFaint }}>{usage.calls.toLocaleString()} generations across {usage.byModel.length} models</Text>
    </Card>
    {limit > 0 && <Card style={{ padding: space.lg }}>
      <View style={sheet.rowBetween}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text, flex: 1 }}>Monthly budget</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint }}>{money(committed)} / {money(limit)}</Text>
      </View>
      <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: theme.bgSunken, marginTop: space.md, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: percent >= 100 ? theme.danger : percent >= 80 ? theme.warn : theme.accent }} />
      </View>
    </Card>}
    {usage.byModel.map(item => <Card key={item.modelId} style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center' }}>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{item.name}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{item.calls} runs · {item.provider}</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>{money(item.spendNanoUsd)}</Text>
    </Card>)}
    {!usage.byModel.length && <Empty title="No spend yet" text="Usage appears after your first completed generation." />}
  </View>
}

function SettingsView({ name, theme, onSignOut }: { name: string; theme: Theme; onSignOut: () => void }) {
  const { choice, setChoice } = useThemeChoice()
  return <View style={{ gap: space.sm }}>
    <Card style={{ padding: space.lg }}>
      <Text style={{ fontSize: 12, color: theme.textFaint }}>Signed in as</Text>
      <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, marginTop: 4 }}>{name}</Text>
    </Card>

    <Card style={{ padding: space.lg }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>Appearance</Text>
      <Text style={{ fontSize: 12, color: theme.textFaint, marginTop: 2, marginBottom: space.md }}>Applies to this device.</Text>
      <View style={{ flexDirection: 'row', padding: 3, gap: 3, borderRadius: radius.md, backgroundColor: theme.bgSunken }}>
        {(['system', 'light', 'dark'] as const).map(value => (
          <TouchableOpacity
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: choice === value }}
            onPress={() => setChoice(value as ThemeChoice)}
            style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: choice === value ? theme.bgRaised : 'transparent' }}
          >
            <Text style={{ fontSize: 13, fontWeight: choice === value ? '600' : '400', color: choice === value ? theme.text : theme.textMuted, textTransform: 'capitalize' }}>{value}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Card>

    <Card style={{ padding: space.lg }}>
      <Text style={{ fontSize: 13, color: theme.textMuted, lineHeight: 20 }}>
        Account details and model access are managed by your workspace administrator.
      </Text>
    </Card>

    <Button label="Sign out" tone="danger" onPress={onSignOut} style={{ marginTop: space.sm }} />
  </View>
}

function ThreadScreen({
  model, sessionId, onBack, onNew, onCreated, onRefresh,
}: {
  model: ApiModel
  sessionId?: string
  onBack: () => void
  onNew: () => void
  onCreated: (generation: ApiGeneration) => void
  onRefresh: () => Promise<void>
}) {
  const theme = useTheme()
  const kind = model.kind as Kind
  const [turns, setTurns] = useState<ApiGeneration[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aspect, setAspect] = useState(kind === 'image' ? '1:1' : '16:9')
  const [duration, setDuration] = useState('10 seconds')
  const [references, setReferences] = useState<ApiUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const [thread, setThread] = useState<string | undefined>(sessionId)

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void getSession(sessionId)
      .then(data => { if (alive) setTurns(data.generations) })
      .catch(() => { if (alive) setError('This chat could not be loaded.') })
    return () => { alive = false }
  }, [sessionId])

  // Reading a generation advances it server-side, so polling both refreshes the
  // view and moves queued work along.
  const waiting = turns.some(item => item.status === 'queued')
  useEffect(() => {
    if (!waiting) return
    let alive = true
    const timer = setInterval(async () => {
      const queued = turns.filter(item => item.status === 'queued').slice(0, 3)
      for (const item of queued) {
        try {
          const next = (await getGeneration(item.id)).generation
          if (!alive) return
          setTurns(items => items.map(entry => (entry.id === next.id ? next : entry)))
          onCreated(next)
        } catch {
          /* a failed poll simply retries on the next tick */
        }
      }
    }, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [waiting, turns, onCreated])

  const attach = async () => {
    setError('')
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: kind === 'image' ? 'image/*' : ['image/*', 'video/*', 'audio/*'],
        multiple: true, copyToCacheDirectory: true,
      })
      if (picked.canceled) return
      const room = Math.max(0, 5 - references.length)
      if (!room) return setError('You can attach up to five references.')
      setUploading(true)
      const uploaded = await Promise.all(picked.assets.slice(0, room).map(asset =>
        uploadMobileReference({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType })))
      setReferences(items => [...items, ...uploaded.map(item => item.upload)])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That reference could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  // Feeding a finished result back in is how an existing image or video is edited.
  const reuse = async (generation: ApiGeneration) => {
    if (!generation.resultUrl) return
    setError(''); setUploading(true)
    try {
      const extension = generation.kind === 'video' ? 'mp4' : 'png'
      const target = `${FileSystem.cacheDirectory}reuse-${generation.id}.${extension}`
      const downloaded = await FileSystem.downloadAsync(generation.resultUrl, target)
      const uploaded = await uploadMobileReference({
        uri: downloaded.uri,
        name: `cresco-${generation.id}.${extension}`,
        mimeType: generation.kind === 'video' ? 'video/mp4' : 'image/png',
      })
      setReferences(items => [...items.filter(item => item.id !== uploaded.upload.id), uploaded.upload].slice(0, 5))
      setPrompt(current => current || 'Edit this: ')
    } catch {
      setError('That result could not be reused. Download it and attach it manually.')
    } finally {
      setUploading(false)
    }
  }

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true); setError('')
    try {
      const options: Record<string, string> = kind === 'text' ? {} : kind === 'video' ? { aspect, duration } : { aspect }
      const created = (await submitGeneration(model.id, prompt.trim(), options, references.map(item => item.id), thread)).generation
      setTurns(items => [...items, created])
      onCreated(created)
      if (!thread && created.sessionId) setThread(created.sessionId)
      setPrompt(''); setReferences([])
      void onRefresh().catch(() => undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bg }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <ChevronLeft size={22} color={theme.textMuted} />
      </TouchableOpacity>
      <View style={sheet.grow}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>{model.name}</Text>
        <Text style={{ fontSize: 12, color: theme.textFaint }}>{model.provider}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="New chat" onPress={onNew} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border }}>
        <Plus size={14} color={theme.textMuted} />
        <Text style={{ fontSize: 13, fontWeight: '500', color: theme.textMuted }}>New</Text>
      </TouchableOpacity>
    </View>

    <KeyboardAvoidingView style={sheet.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <ScrollView contentContainerStyle={sheet.scroll}>
        {turns.length ? <View style={{ gap: space.md }}>
          {turns.map(item => <Card key={item.id} style={{ padding: space.lg, gap: space.sm }}>
            <View style={sheet.rowBetween}>
              <Text style={{ fontSize: 12, color: theme.textFaint, flex: 1 }}>{relativeTime(item.createdAt)}</Text>
              {item.providerLatencyMs ? <Text style={{ fontSize: 12, color: theme.textFaint }}>{elapsed(item.providerLatencyMs)}</Text> : null}
              <StatusPill status={item.status} />
            </View>
            <Text style={{ fontSize: 14, color: theme.textMuted, lineHeight: 21 }}>{item.prompt}</Text>
            {item.status === 'queued' && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={{ fontSize: 13, color: theme.textFaint }}>Working{item.queuedForMs ? ` · ${elapsed(item.queuedForMs)}` : ''}</Text>
            </View>}
            {item.error ? <ErrorNote>{item.error}</ErrorNote> : null}
            {item.outputText ? <Text selectable style={{ fontSize: 15, color: theme.text, lineHeight: 23 }}>{item.outputText}</Text> : null}
            {item.resultUrl ? <ResultMedia generation={item} theme={theme} onReuse={() => void reuse(item)} /> : null}
          </Card>)}
        </View> : <Empty title={`Start with ${model.name}`} text={kind === 'text' ? 'Write a prompt below and the response appears here.' : 'Describe what you want and the result appears here.'} />}
      </ScrollView>

      <View style={{ padding: space.md, gap: space.sm, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bgSubtle }}>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {references.length > 0 && <View style={{ gap: 6 }}>
          {references.map(reference => <View key={reference.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: theme.bgSunken }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.textMuted }}>{reference.fileName}</Text>
            <TouchableOpacity accessibilityLabel={`Remove ${reference.fileName}`} onPress={() => setReferences(items => items.filter(item => item.id !== reference.id))}>
              <X size={14} color={theme.textFaint} />
            </TouchableOpacity>
          </View>)}
        </View>}
        {kind !== 'text' && <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip label={aspect} theme={theme} onPress={() => setAspect(value => (value === '16:9' ? '9:16' : value === '9:16' ? '1:1' : '16:9'))} />
          {kind === 'video' && <Chip label={duration} theme={theme} onPress={() => setDuration(value => (value === '5 seconds' ? '10 seconds' : value === '10 seconds' ? '15 seconds' : '5 seconds'))} />}
        </View>}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          {kind !== 'text' && <TouchableOpacity
            accessibilityLabel="Add reference"
            disabled={uploading || references.length >= 5}
            onPress={attach}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgRaised }}
          >
            <Paperclip size={17} color={theme.textMuted} />
          </TouchableOpacity>}
          <TextInput
            multiline
            value={prompt}
            onChangeText={setPrompt}
            placeholder={kind === 'text' ? `Message ${model.name}…` : 'Describe what you want…'}
            placeholderTextColor={theme.textFaint}
            style={{
              flex: 1, minHeight: 44, maxHeight: 130, color: theme.text, fontSize: 15, lineHeight: 21,
              paddingHorizontal: space.md, paddingTop: 12, paddingBottom: 12,
              backgroundColor: theme.bgRaised, borderWidth: 1, borderColor: theme.border, borderRadius: radius.md,
            }}
          />
          <TouchableOpacity
            accessibilityLabel="Send"
            disabled={!prompt.trim() || busy || uploading}
            onPress={generate}
            style={{
              width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
              backgroundColor: theme.accent, opacity: !prompt.trim() || busy || uploading ? 0.45 : 1,
            }}
          >
            {busy ? <ActivityIndicator size="small" color={theme.accentText} /> : <Send size={17} color={theme.accentText} />}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function Chip({ label, onPress, theme }: { label: string; onPress: () => void; theme: Theme }) {
  return <TouchableOpacity onPress={onPress} style={{ minHeight: 34, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgRaised }}>
    <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted }}>{label}</Text>
  </TouchableOpacity>
}

function ResultMedia({ generation, theme, onReuse }: { generation: ApiGeneration; theme: Theme; onReuse?: () => void }) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const save = async () => {
    if (!generation.resultUrl) return
    setSaving(true); setSaveError('')
    try {
      const clean = generation.resultUrl.split('?')[0]
      const extension = clean.split('.').pop()?.slice(0, 5) || (generation.kind === 'video' ? 'mp4' : 'png')
      const target = `${FileSystem.cacheDirectory}cresco-${generation.id}.${extension}`
      const downloaded = await FileSystem.downloadAsync(generation.resultUrl, target)
      if (!(await Sharing.isAvailableAsync())) throw new Error('Saving is not available on this device.')
      await Sharing.shareAsync(downloaded.uri, { dialogTitle: 'Save Cresco result' })
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'That result could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  return <View style={{ gap: space.sm }}>
    {generation.kind === 'image'
      ? <Image source={{ uri: generation.resultUrl! }} resizeMode="contain" style={{ width: '100%', height: 280, borderRadius: radius.md, backgroundColor: theme.bgSunken }} />
      : <ResultVideo url={generation.resultUrl!} background={theme.bgSunken} />}
    {saveError ? <ErrorNote>{saveError}</ErrorNote> : null}
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button label={saving ? 'Preparing…' : 'Save'} tone="secondary" icon={ArrowDownToLine} busy={saving} onPress={save} style={{ flex: 1 }} />
      {onReuse && <Button label="Use as reference" tone="secondary" onPress={onReuse} style={{ flex: 1 }} />}
    </View>
  </View>
}

function ResultVideo({ url, background }: { url: string; background: string }) {
  const player = useVideoPlayer(url, instance => { instance.loop = false })
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', height: 240, borderRadius: radius.md, backgroundColor: background }} />
}

function SignIn({ onSignedIn }: { onSignedIn: (email: string, password: string) => Promise<void> }) {
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = email.trim().length > 0 && password.length > 0

  const submit = async () => {
    setBusy(true); setError('')
    try { await onSignedIn(email.trim(), password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }

  const input = {
    minHeight: 48, color: theme.text, backgroundColor: theme.bgRaised, borderWidth: 1, borderColor: theme.border,
    borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16,
  }

  return <SafeAreaView style={[sheet.screen, { backgroundColor: theme.bgSubtle }]}>
    <KeyboardAvoidingView style={[sheet.screen, { justifyContent: 'center', padding: space.xl }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text, letterSpacing: -0.4 }}>Sign in</Text>
      <Text style={{ fontSize: 14, color: theme.textMuted, marginTop: 6, marginBottom: space.xl }}>Your team's private model workspace.</Text>

      <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted, marginBottom: 6 }}>Email</Text>
      <TextInput style={input} value={email} onChangeText={setEmail} placeholder="you@company.com" placeholderTextColor={theme.textFaint} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />

      <Text style={{ fontSize: 12, fontWeight: '500', color: theme.textMuted, marginTop: space.lg, marginBottom: 6 }}>Password</Text>
      <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" placeholderTextColor={theme.textFaint} />

      {error ? <View style={{ marginTop: space.lg }}><ErrorNote>{error}</ErrorNote></View> : null}

      <Button label={busy ? 'Signing in…' : 'Sign in'} busy={busy} disabled={!ready} onPress={submit} style={{ marginTop: space.xl }} />
      <Text style={{ fontSize: 12, color: theme.textFaint, lineHeight: 18, marginTop: space.lg }}>
        Access is invite only. An administrator creates and approves every account.
      </Text>
    </KeyboardAvoidingView>
  </SafeAreaView>
}
