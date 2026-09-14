import { useCallback, useEffect, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { VideoView, useVideoPlayer } from 'expo-video'
import { Image, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ArrowDownToLine, ArrowUpRight, Bell, Clock3, Gauge, Grid2x2, Image as ImageIcon, LockKeyhole, MessageSquare, Settings, Sparkles, Upload, Video, X } from 'lucide-react-native'
import { colors, radius } from '@cresco/mobile-shared/tokens'
import { clearMobileSession, getGeneration, getMemberWorkspace, login as apiLogin, restoreMobileSession, submitGeneration, uploadMobileReference, type ApiGeneration, type ApiUpload, type UsageSummary } from '@cresco/mobile-shared/api'

type MobileModel = { id: string; name: string; provider: string; type: 'Text' | 'Image' | 'Video'; icon: any; tint: string; estimate: string; ready?: boolean }
const modelFixtures: MobileModel[] = [
  { id: 'gpt', name: 'GPT-5', provider: 'OpenAI', type: 'Text', icon: MessageSquare, tint: colors.coral, estimate: '$0.02' },
  { id: 'claude', name: 'Claude Sonnet', provider: 'Anthropic', type: 'Text', icon: Sparkles, tint: colors.lilac, estimate: '$0.03' },
  { id: 'veo', name: 'Veo 3', provider: 'Google', type: 'Video', icon: Video, tint: colors.blue, estimate: '$0.62' },
  { id: 'seedance', name: 'Seedance 2.0', provider: 'fal.ai · ByteDance', type: 'Video', icon: Video, tint: colors.sage, estimate: '$3.03' },
  { id: 'imagen', name: 'Imagen 4', provider: 'Google', type: 'Image', icon: ImageIcon, tint: colors.sand, estimate: '$0.08' },
]

export default function App() {
  const [tab, setTab] = useState('Home')
  const [loggedIn, setLoggedIn] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [memberName, setMemberName] = useState('Team member')
  const [models, setModels] = useState<MobileModel[]>(modelFixtures)
  const [history, setHistory] = useState<ApiGeneration[]>([])
  const [usage, setUsage] = useState<UsageSummary>({ spendNanoUsd: 0, calls: 0, byModel: [], balances: [] })
  const [selectedModel, setSelectedModel] = useState<MobileModel | null>(null)
  const [refreshing,setRefreshing]=useState(false)
  const refresh=useCallback(async()=>{
    const data=await getMemberWorkspace()
    const tints=[colors.coral,colors.lilac,colors.blue,colors.sage,colors.sand]
    setModels(data.models.map((item,index)=>{
      const fixture=modelFixtures.find(model=>model.id===item.id||model.name===item.name)
      const type=(item.kind[0].toUpperCase()+item.kind.slice(1)) as MobileModel['type']
      return {id:item.id,name:item.name,provider:item.provider,type,icon:fixture?.icon||(type==='Video'?Video:type==='Image'?ImageIcon:MessageSquare),tint:fixture?.tint||tints[index%tints.length],estimate:item.priceNanoUsd?(item.priceNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'}):'Tracked after run',ready:Boolean(item.executionReady)}
    }))
    setHistory(data.generations);setUsage(data.usage)
  },[])
  const pullRefresh=useCallback(async()=>{setRefreshing(true);try{await refresh()}catch{ /* Existing content remains visible when a refresh is temporarily unavailable. */ }finally{setRefreshing(false)}},[refresh])
  const hasProcessingWork=history.some(item=>item.status==='queued')
  useEffect(()=>{
    if(!loggedIn||!hasProcessingWork)return
    const timer=setInterval(()=>void refresh().catch(()=>undefined),5000)
    return()=>clearInterval(timer)
  },[loggedIn,hasProcessingWork,refresh])
  useEffect(()=>{
    let active=true
    restoreMobileSession().then(async session=>{
      if(!active||!session)return
      await refresh()
      if(active){setMemberName(session.user.name);setLoggedIn(true)}
    }).catch(()=>void clearMobileSession()).finally(()=>{if(active)setRestoring(false)})
    return()=>{active=false}
  },[refresh])
  if(restoring)return <SafeAreaView style={styles.safe}><View style={styles.splash}><Sparkles size={22} color={colors.ink}/><Text style={styles.kicker}>CRESCO LABS</Text></View></SafeAreaView>
  if (!loggedIn) return <Login onLogin={async (email,password) => {
    const session = await apiLogin(email,password,'team-mobile')
    await refresh();setMemberName(session.user.name);setLoggedIn(true)
  }} />
  if (selectedModel) return <Workspace model={selectedModel} onBack={() => setSelectedModel(null)} onRefresh={refresh} onSubmitted={generation=>setHistory(items=>[generation,...items])} />
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={colors.ink} colors={[colors.ink]} progressBackgroundColor={colors.glassStrong}/>}><View style={styles.header}><View><Text style={styles.kicker}>CRESCO LABS</Text><Text style={styles.title}>Welcome, {memberName.split(' ')[0]} <Text style={styles.star}>✦</Text></Text><Text style={styles.sub}>Your models are ready. What are we making?</Text></View><View style={styles.avatar}><Text>{memberName.split(' ').map(part=>part[0]).join('').slice(0,2)}</Text></View></View><View style={styles.pillNav}>{[['Home', Grid2x2], ['History', Clock3], ['Usage', Gauge], ['Settings', Settings]].map(([label, Icon]: any) => <TouchableOpacity key={label} style={[styles.navItem, tab === label && styles.navSelected]} onPress={()=>setTab(label)}><Icon size={14} color={tab === label ? colors.ink : colors.muted}/><Text style={styles.navText}>{label}</Text></TouchableOpacity>)}</View>{tab === 'Home' ? <HomeView models={models} onSelect={setSelectedModel}/> : tab === 'History' ? <HistoryView history={history} models={models}/> : tab === 'Usage' ? <UsageView usage={usage}/> : <SettingsView onLogout={()=>{void clearMobileSession();setLoggedIn(false);setTab('Home')}}/>}</ScrollView></SafeAreaView>
}

function HomeView({models,onSelect}:{models:MobileModel[];onSelect:(model:MobileModel)=>void}){return <><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Model studio</Text><Text style={styles.sectionSub}>{models.filter(model=>model.ready).length} ready · {models.length} connected</Text></View>{models.map(model=>{const Icon=model.icon;return <TouchableOpacity disabled={!model.ready} key={model.id} style={[styles.card,!model.ready&&styles.cardDisabled]} activeOpacity={.85} onPress={()=>onSelect(model)}><View style={[styles.modelIcon,{backgroundColor:model.tint}]}><Icon size={20} color={colors.ink}/></View><View style={styles.cardCopy}><Text style={styles.modelType}>{model.type.toUpperCase()} · {model.provider}</Text><Text style={styles.modelName}>{model.name}</Text><Text style={styles.modelDesc}>{model.ready?'Create, explore and turn an idea into something real.':'Waiting for administrator setup.'}</Text></View>{model.ready?<ArrowUpRight size={17} color={colors.muted}/>:<LockKeyhole size={16} color={colors.muted}/>}</TouchableOpacity>})}</>}
function HistoryView({history,models}:{history:ApiGeneration[];models:MobileModel[]}){
  const [selectedId,setSelectedId]=useState<string|null>(null)
  return <View><Text style={styles.sectionTitle}>History</Text><Text style={styles.sectionSub}>Your latest work across every model.</Text>{history.map(item=>{
    const model=models.find(entry=>entry.id===item.modelId)
    const type=((item.kind[0].toUpperCase()+item.kind.slice(1)) as MobileModel['type'])
    const selected=selectedId===item.id
    return <View key={item.id}><TouchableOpacity disabled={item.status==='queued'} onPress={()=>setSelectedId(value=>value===item.id?null:item.id)} style={mobile.listRow}><View style={mobile.historyDot}/><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{item.title}</Text><Text style={mobile.actionMeta}>{model?.name||item.modelName||item.modelId} · {item.modelProvider||'Provider'} · {(item.costNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})} · {item.status==='queued'?'Processing':item.status==='complete'?'Complete':'Failed'}</Text>{item.outputText&&!selected?<Text style={mobile.responseText} numberOfLines={4}>{item.outputText}</Text>:null}</View>{item.status==='queued'?<Clock3 size={15} color={colors.muted}/>:<Text style={[mobile.chevron,selected&&mobile.chevronOpen]}>›</Text>}</TouchableOpacity>{selected&&item.status==='complete'?<MobileResult generation={item} type={type}/>:selected&&item.status==='failed'?<View style={[mobile.resultCard,mobile.failedCard]}><X size={20} color="#A94E43"/><View style={styles.cardCopy}><Text style={mobile.resultTitle}>Request failed</Text><Text style={mobile.resultMeta}>{item.error||'The provider could not complete this request.'}</Text></View></View>:null}</View>
  })}</View>
}
function UsageView({usage}:{usage:UsageSummary}){
  const limit=Number(usage.budget?.workspaceMonthlyLimitNanoUsd||0)
  const committed=Number(usage.monthlyCommittedNanoUsd||0)
  return <View><Text style={styles.sectionTitle}>Usage</Text><Text style={styles.sectionSub}>Spend is visible to everyone on the team.</Text><View style={mobile.metricCard}><Text style={mobile.metricLabel}>TRACKED TEAM SPEND</Text><Text style={mobile.metricValue}>{(usage.spendNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})}</Text><Text style={mobile.actionMeta}>{usage.calls.toLocaleString()} generations across {usage.byModel.length} models</Text></View><View style={mobile.metricCard}><Text style={mobile.metricLabel}>MONTHLY WORKSPACE BUDGET</Text><Text style={mobile.metricValue}>{limit>0?(limit/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'}):'No cap'}</Text><Text style={mobile.actionMeta}>{(committed/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})} committed this month{limit>0?` · warning at ${usage.budget?.warnAtPercent||80}%`:''}</Text></View>{usage.byModel.map(item=>{const share=usage.spendNanoUsd?Math.round(item.spendNanoUsd/usage.spendNanoUsd*100):0;return <View style={mobile.usageRow} key={item.modelId}><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{item.name}</Text><Text style={mobile.actionMeta}>{share}% of total · {item.calls} calls</Text></View><Text style={mobile.usageCost}>{(item.spendNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})}</Text></View>})}</View>
}
function SettingsView({onLogout}:{onLogout:()=>void}){const [completion,setCompletion]=useState(true);const [weekly,setWeekly]=useState(true);return <View><Text style={styles.sectionTitle}>Settings</Text><Text style={styles.sectionSub}>Your personal Cresco Labs preferences.</Text><SettingToggle icon={Bell} title="Generation completed" detail="Notify me when media is ready" value={completion} onChange={setCompletion}/><SettingToggle icon={Gauge} title="Weekly usage summary" detail="Monday team spend overview" value={weekly} onChange={setWeekly}/><Setting icon={LockKeyhole} title="Privacy & sessions" detail="Current device · Active now"/><Setting icon={Settings} title="Appearance" detail="System theme · Liquid Glass"/><TouchableOpacity style={styles.loginButton} onPress={onLogout}><Text style={styles.loginButtonText}>Log out</Text></TouchableOpacity></View>}
function SettingToggle({icon:Icon,title,detail,value,onChange}:{icon:any,title:string,detail:string,value:boolean,onChange:(value:boolean)=>void}){return <View style={mobile.listRow}><View style={mobile.settingIcon}><Icon size={17} color="#719552"/></View><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{title}</Text><Text style={mobile.actionMeta}>{detail}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{false:'#D9DFDA',true:'#A8CB85'}} thumbColor="#fff"/></View>}
function Setting({icon:Icon,title,detail}:{icon:any,title:string,detail:string}){return <TouchableOpacity style={mobile.listRow}><View style={mobile.settingIcon}><Icon size={17} color="#719552"/></View><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{title}</Text><Text style={mobile.actionMeta}>{detail}</Text></View><ChevronMark/></TouchableOpacity>}
function ChevronMark(){return <Text style={mobile.chevron}>›</Text>}

function Workspace({ model, onBack, onRefresh, onSubmitted }: { model: MobileModel; onBack: () => void; onRefresh: () => Promise<void>; onSubmitted: (generation: ApiGeneration) => void }) {
  const [prompt, setPrompt] = useState('')
  const [generation, setGeneration] = useState<ApiGeneration|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [aspect,setAspect]=useState(model.type==='Image'?'1:1':'16:9')
  const [duration,setDuration]=useState('10 seconds')
  const [references,setReferences]=useState<ApiUpload[]>([])
  const [uploading,setUploading]=useState(false)
  const [refreshing,setRefreshing]=useState(false)
  const Icon = model.icon
  useEffect(()=>{
    if(!generation||generation.status!=='queued')return
    let active=true
    let timer:ReturnType<typeof setTimeout>
    const poll=async()=>{try{const next=(await getGeneration(generation.id)).generation;if(!active)return;setGeneration(next);if(next.status==='queued')timer=setTimeout(poll,2000)}catch(reason){if(active)setError(reason instanceof Error?reason.message:'Could not refresh the provider response.')}}
    timer=setTimeout(poll,1200)
    return()=>{active=false;clearTimeout(timer)}
  },[generation?.id,generation?.status])
  const attach=async()=>{setError('');try{const picked=await DocumentPicker.getDocumentAsync({type:model.type==='Image'?'image/*':['image/*','video/*','audio/*'],multiple:true,copyToCacheDirectory:true});if(picked.canceled)return;const available=Math.max(0,5-references.length);if(!available)return setError('You can attach up to five references.');setUploading(true);const uploaded=await Promise.all(picked.assets.slice(0,available).map(asset=>uploadMobileReference({uri:asset.uri,name:asset.name,mimeType:asset.mimeType})));setReferences(items=>[...items,...uploaded.map(item=>item.upload)])}catch(reason){setError(reason instanceof Error?reason.message:'Could not upload this reference.')}finally{setUploading(false)}}
  const generate=async()=>{if(!prompt.trim())return;setBusy(true);setError('');setGeneration(null);try{const next=(await submitGeneration(model.id,prompt.trim(),{aspect,...(model.type==='Video'?{duration}:{})},references.map(item=>item.id))).generation;onSubmitted(next);setGeneration(next)}catch(reason){setError(reason instanceof Error?reason.message:'Could not send this request.')}finally{setBusy(false)}}
  const pullRefresh=async()=>{setRefreshing(true);setError('');try{await onRefresh();if(generation)setGeneration((await getGeneration(generation.id)).generation)}catch(reason){setError(reason instanceof Error?reason.message:'Could not refresh this workspace.')}finally{setRefreshing(false)}}
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={colors.ink} colors={[colors.ink]} progressBackgroundColor={colors.glassStrong}/> }>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back to studio</Text></TouchableOpacity>
      <View style={[styles.workspaceIcon,{backgroundColor:model.tint}]}><Icon size={24} color={colors.ink}/></View>
      <Text style={styles.kicker}>{model.provider} · {model.type} WORKSPACE</Text>
      <Text style={styles.workspaceTitle}>Create with {model.name}</Text>
      <Text style={styles.sub}>{model.type === 'Video' ? 'Describe a scene, movement and mood.' : model.type === 'Text' ? 'Ask a question or describe what you want to make.' : 'Describe the visual you want to create.'}</Text>
      {model.type !== 'Text' && <View style={styles.options}><TouchableOpacity style={styles.optionsTouchable} onPress={()=>setAspect(aspect==='16:9'?'9:16':aspect==='9:16'?'1:1':'16:9')}><Text style={styles.optionsText}>{aspect} ⌄</Text></TouchableOpacity>{model.type==='Video'&&<TouchableOpacity style={styles.optionsTouchable} onPress={()=>setDuration(duration==='5 seconds'?'10 seconds':duration==='10 seconds'?'15 seconds':'5 seconds')}><Text style={styles.optionsText}>{duration} ⌄</Text></TouchableOpacity>}</View>}
      <TextInput style={styles.prompt} multiline placeholder={model.type === 'Video' ? 'Describe your scene...' : 'Start writing your prompt...'} placeholderTextColor={colors.muted} selectionColor={colors.sage} value={prompt} onChangeText={value=>{setPrompt(value);setGeneration(null)}}/>
      {model.type!=='Text'&&<><TouchableOpacity disabled={uploading||references.length>=5} style={mobile.uploadButton} onPress={attach}><Upload size={15} color={colors.muted}/><Text style={mobile.uploadText}>{uploading?'Uploading…':`Add reference files · ${references.length}/5`}</Text></TouchableOpacity>{references.map(reference=><View style={mobile.referenceRow} key={reference.id}><View style={styles.cardCopy}><Text style={mobile.actionTitle} numberOfLines={1}>{reference.fileName}</Text><Text style={mobile.actionMeta}>{(reference.size/1024/1024).toFixed(1)} MB</Text></View><TouchableOpacity onPress={()=>setReferences(items=>items.filter(item=>item.id!==reference.id))}><X size={15} color={colors.muted}/></TouchableOpacity></View>)}</>}
      {error?<Text style={styles.loginNote}>{error}</Text>:null}
      {generation?.status==='queued'&&<View style={mobile.resultCard}><View style={mobile.processingDot}/><View style={styles.cardCopy}><Text style={mobile.resultTitle}>Provider is processing</Text><Text style={mobile.resultMeta}>The request was sent immediately. This screen will update automatically.</Text></View></View>}
      {generation?.status==='failed'&&<View style={[mobile.resultCard,mobile.failedCard]}><X size={20} color="#A94E43"/><View style={styles.cardCopy}><Text style={mobile.resultTitle}>Request failed</Text><Text style={mobile.resultMeta}>{generation.error||'The provider could not complete this request.'}</Text></View></View>}
      {generation?.status==='complete'&&<MobileResult generation={generation} type={model.type}/>}
      <View style={styles.workspaceFooter}>
        <Text style={styles.cost}>Estimated cost · <Text style={{fontWeight:'700'}}>{model.estimate}</Text></Text>
        <TouchableOpacity disabled={!prompt.trim()||busy||uploading} onPress={generate} style={[styles.generate,(!prompt.trim()||busy||uploading)&&styles.generateDisabled]}><Sparkles size={17} color="#fff"/><Text style={styles.generateText}>{busy?'Sending…':'Generate'}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </SafeAreaView>
}

function MobileResult({generation,type}:{generation:ApiGeneration;type:MobileModel['type']}){
  const [saving,setSaving]=useState(false)
  const [saveError,setSaveError]=useState('')
  const save=async()=>{if(!generation.resultUrl)return;setSaving(true);setSaveError('');try{const clean=generation.resultUrl.split('?')[0];const ext=clean.split('.').pop()?.slice(0,5)||(type==='Video'?'mp4':'png');const target=FileSystem.cacheDirectory+`cresco-${generation.id}.${ext}`;const downloaded=await FileSystem.downloadAsync(generation.resultUrl,target);if(!(await Sharing.isAvailableAsync()))throw new Error('Saving is not available on this device.');await Sharing.shareAsync(downloaded.uri,{dialogTitle:'Save Cresco result'})}catch(reason){setSaveError(reason instanceof Error?reason.message:'Could not save this result.')}finally{setSaving(false)}}
  return <View style={mobile.inlineResult}><View style={mobile.resultHeading}><Sparkles size={20} color="#70964F"/><View><Text style={mobile.resultTitle}>Result ready</Text><Text style={mobile.resultMeta}>View and save it without leaving Cresco</Text></View></View>{generation.outputText?<Text selectable style={mobile.outputText}>{generation.outputText}</Text>:null}{generation.resultUrl&&type==='Image'?<Image source={{uri:generation.resultUrl}} resizeMode="contain" style={mobile.resultImage}/>:null}{generation.resultUrl&&type==='Video'?<MobileVideo url={generation.resultUrl}/>:null}{saveError?<Text style={styles.loginNote}>{saveError}</Text>:null}{generation.resultUrl?<TouchableOpacity disabled={saving} style={[mobile.downloadButton,{flex:0,marginTop:15}]} onPress={save}><ArrowDownToLine size={17} color="#fff"/><Text style={mobile.downloadText}>{saving?'Preparing…':'Download / save'}</Text></TouchableOpacity>:null}</View>
}

function MobileVideo({url}:{url:string}){
  const player=useVideoPlayer(url,instance=>{instance.loop=false})
  return <VideoView player={player} nativeControls contentFit="contain" style={mobile.resultVideo}/>
}

function Login({ onLogin }: { onLogin: (email:string,password:string) => Promise<void> }) {
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const ready=email.trim().length>0&&password.trim().length>0
  const submit=async()=>{setLoading(true);setError('');try{await onLogin(email,password)}catch(reason){setError(reason instanceof Error?reason.message:'Login failed.')}finally{setLoading(false)}}
  return <SafeAreaView style={styles.safe}><View style={styles.login}>
    <Text style={styles.kicker}>CRESCO LABS</Text><Text style={styles.loginTitle}>Welcome back.</Text>
    <Text style={styles.loginSub}>Log in to continue to your team’s private model studio.</Text>
    <Text style={styles.label}>EMAIL ADDRESS</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@company.com" placeholderTextColor={colors.muted} selectionColor={colors.sage} autoCapitalize="none" keyboardType="email-address"/>
    <Text style={styles.label}>PASSWORD</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor={colors.muted} selectionColor={colors.sage} secureTextEntry/>
    {error?<Text style={styles.loginNote}>{error}</Text>:null}
    <TouchableOpacity disabled={!ready||loading} style={[styles.loginButton,(!ready||loading)&&styles.generateDisabled]} onPress={submit}><Text style={styles.loginButtonText}>{loading?'Logging in…':'Log in'}</Text></TouchableOpacity>
    <Text style={styles.loginNote}>Access is invite-only. Your account is created and approved by an admin.</Text>
  </View></SafeAreaView>
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},splash:{flex:1,alignItems:'center',justifyContent:'center',gap:16},content:{padding:24,paddingTop:32,paddingBottom:64},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:14},kicker:{fontSize:12,letterSpacing:1.7,fontWeight:'800',color:colors.muted},title:{fontSize:34,fontWeight:'800',color:colors.ink,marginTop:14,letterSpacing:-1},star:{color:colors.coral},sub:{fontSize:15,color:colors.muted,marginTop:8,lineHeight:22},avatar:{width:44,height:44,borderRadius:22,backgroundColor:'#D8AA98',alignItems:'center',justifyContent:'center'},pillNav:{alignSelf:'center',flexDirection:'row',padding:5,backgroundColor:colors.glass,borderColor:colors.line,borderWidth:1,borderRadius:radius.pill,marginTop:30,marginBottom:38},navItem:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,minHeight:44,paddingHorizontal:14,paddingVertical:11,borderRadius:radius.pill},navSelected:{backgroundColor:colors.glassStrong},navText:{fontSize:13,fontWeight:'600',color:colors.muted},sectionHead:{marginBottom:18},sectionTitle:{fontSize:23,fontWeight:'800',color:colors.ink},sectionSub:{fontSize:14,color:colors.muted,marginTop:6,lineHeight:20},card:{flexDirection:'row',alignItems:'center',gap:15,padding:18,minHeight:88,marginBottom:14,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},cardDisabled:{opacity:.58},modelIcon:{width:50,height:50,borderRadius:15,alignItems:'center',justifyContent:'center'},cardCopy:{flex:1},modelType:{fontSize:11,letterSpacing:1.05,fontWeight:'700',color:colors.muted},modelName:{fontSize:18,fontWeight:'800',color:colors.ink,marginTop:5},modelDesc:{fontSize:13,color:colors.muted,marginTop:5,lineHeight:19},empty:{paddingTop:40},login:{margin:18,padding:28,borderRadius:24,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginTop:60},loginTitle:{fontSize:36,fontWeight:'800',color:colors.ink,marginTop:28,letterSpacing:-1},loginSub:{fontSize:15,color:colors.muted,lineHeight:22,marginTop:9,marginBottom:24},label:{fontSize:11,letterSpacing:1.1,fontWeight:'800',color:colors.muted,marginTop:18,marginBottom:8},input:{minHeight:54,color:colors.ink,backgroundColor:colors.glassStrong,borderWidth:1,borderColor:colors.line,borderRadius:13,paddingHorizontal:16,paddingVertical:14,fontSize:16},loginButton:{minHeight:54,marginTop:27,padding:16,alignItems:'center',justifyContent:'center',backgroundColor:colors.ink,borderRadius:13},loginButtonText:{color:'#fff',fontSize:15,fontWeight:'800'},loginNote:{fontSize:13,color:colors.muted,lineHeight:19,marginTop:20},back:{fontSize:14,fontWeight:'700',color:colors.muted,marginBottom:30},workspaceIcon:{width:58,height:58,borderRadius:18,alignItems:'center',justifyContent:'center',marginBottom:20},workspaceTitle:{fontSize:34,fontWeight:'800',color:colors.ink,marginTop:14,marginBottom:8,letterSpacing:-.8},options:{flexDirection:'row',flexWrap:'wrap',gap:9,marginTop:25},optionsTouchable:{minHeight:44,justifyContent:'center',paddingHorizontal:14,paddingVertical:11,backgroundColor:colors.glass,borderColor:colors.line,borderWidth:1,borderRadius:12},optionsText:{fontSize:14,fontWeight:'700',color:colors.ink},prompt:{minHeight:190,color:colors.ink,backgroundColor:colors.glassStrong,borderColor:colors.line,borderWidth:1,borderRadius:radius.card,padding:18,fontSize:16,lineHeight:23,marginTop:18,textAlignVertical:'top'},workspaceFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:14,marginTop:21},cost:{flex:1,fontSize:13,color:colors.muted},generate:{minHeight:50,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:colors.ink,paddingHorizontal:18,paddingVertical:14,borderRadius:13},generateDisabled:{opacity:.45},generateText:{fontSize:14,color:'#fff',fontWeight:'800'}})
const mobile=StyleSheet.create({listRow:{flexDirection:'row',alignItems:'center',gap:13,padding:17,minHeight:72,marginTop:12,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},historyDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.sage},actionTitle:{fontSize:15,fontWeight:'800',color:colors.ink},actionMeta:{fontSize:13,color:colors.muted,marginTop:5,lineHeight:18},responseText:{fontSize:14,color:colors.ink,lineHeight:21,marginTop:11},chevron:{fontSize:25,color:colors.muted},chevronOpen:{transform:[{rotate:'90deg'}]},metricCard:{padding:23,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginTop:22,marginBottom:19},metricLabel:{fontSize:11,letterSpacing:1.1,fontWeight:'700',color:colors.muted},metricValue:{fontSize:36,fontWeight:'800',color:colors.ink,marginVertical:10},usageRow:{flexDirection:'row',alignItems:'center',paddingVertical:18,borderBottomWidth:1,borderBottomColor:'#ffffffaa'},usageCost:{fontSize:15,fontWeight:'800',color:colors.ink},settingIcon:{width:44,height:44,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:'#e7f1dc'},uploadButton:{minHeight:50,flexDirection:'row',alignItems:'center',gap:9,paddingVertical:15},uploadText:{fontSize:14,color:colors.muted},referenceRow:{flexDirection:'row',alignItems:'center',padding:14,marginBottom:9,borderRadius:13,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},resultCard:{flexDirection:'row',alignItems:'center',gap:13,padding:18,marginTop:20,borderRadius:radius.card,backgroundColor:'#E7F1DC',borderWidth:1,borderColor:'#CFE2BE'},failedCard:{backgroundColor:'#F8E6E1',borderColor:'#EBCBC3'},processingDot:{width:12,height:12,borderRadius:6,backgroundColor:'#70964F'},resultTitle:{fontSize:16,fontWeight:'800',color:colors.ink},resultMeta:{fontSize:13,color:colors.muted,lineHeight:19,marginTop:4},inlineResult:{padding:18,marginTop:20,marginBottom:17,borderRadius:radius.card,backgroundColor:colors.glassStrong,borderWidth:1,borderColor:colors.line},resultHeading:{flexDirection:'row',alignItems:'center',gap:11,marginBottom:15},outputText:{fontSize:16,color:colors.ink,lineHeight:24},resultImage:{width:'100%',height:320,backgroundColor:'#DDE4DA',borderRadius:15},resultVideo:{width:'100%',height:260,backgroundColor:'#101313',borderRadius:15},resultActions:{flexDirection:'row',gap:10,marginTop:15},downloadButton:{flex:1,minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,padding:13,backgroundColor:colors.ink,borderRadius:12},downloadText:{fontSize:13,fontWeight:'800',color:'#fff'},openButton:{flex:1,minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,padding:13,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,borderRadius:12},openText:{fontSize:13,fontWeight:'800',color:colors.ink}})
