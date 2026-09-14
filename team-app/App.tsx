import { useCallback, useEffect, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { Linking, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ArrowUpRight, Bell, Clock3, Gauge, Grid2x2, Image as ImageIcon, LockKeyhole, MessageSquare, Settings, Sparkles, Upload, Video, X } from 'lucide-react-native'
import { colors, radius } from '@cresco/mobile-shared/tokens'
import { clearMobileSession, getMemberWorkspace, login as apiLogin, queueGeneration, restoreMobileSession, uploadMobileReference, type ApiGeneration, type ApiUpload, type UsageSummary } from '@cresco/mobile-shared/api'

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
  const hasQueuedWork=history.some(item=>item.status==='queued')
  useEffect(()=>{
    if(!loggedIn||!hasQueuedWork)return
    const timer=setInterval(()=>void refresh().catch(()=>undefined),5000)
    return()=>clearInterval(timer)
  },[loggedIn,hasQueuedWork,refresh])
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
  if (selectedModel) return <Workspace model={selectedModel} onBack={() => setSelectedModel(null)} onQueued={generation=>setHistory(items=>[generation,...items])} />
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}><View style={styles.header}><View><Text style={styles.kicker}>CRESCO LABS</Text><Text style={styles.title}>Welcome, {memberName.split(' ')[0]} <Text style={styles.star}>✦</Text></Text><Text style={styles.sub}>Your models are ready. What are we making?</Text></View><View style={styles.avatar}><Text>{memberName.split(' ').map(part=>part[0]).join('').slice(0,2)}</Text></View></View><View style={styles.pillNav}>{[['Home', Grid2x2], ['History', Clock3], ['Usage', Gauge], ['Settings', Settings]].map(([label, Icon]: any) => <TouchableOpacity key={label} style={[styles.navItem, tab === label && styles.navSelected]} onPress={()=>setTab(label)}><Icon size={14} color={tab === label ? colors.ink : colors.muted}/><Text style={styles.navText}>{label}</Text></TouchableOpacity>)}</View>{tab === 'Home' ? <HomeView models={models} onSelect={setSelectedModel}/> : tab === 'History' ? <HistoryView history={history} models={models}/> : tab === 'Usage' ? <UsageView usage={usage}/> : <SettingsView onLogout={()=>{void clearMobileSession();setLoggedIn(false);setTab('Home')}}/>}</ScrollView></SafeAreaView>
}

function HomeView({models,onSelect}:{models:MobileModel[];onSelect:(model:MobileModel)=>void}){return <><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Model studio</Text><Text style={styles.sectionSub}>{models.filter(model=>model.ready).length} ready · {models.length} connected</Text></View>{models.map(model=>{const Icon=model.icon;return <TouchableOpacity disabled={!model.ready} key={model.id} style={[styles.card,!model.ready&&styles.cardDisabled]} activeOpacity={.85} onPress={()=>onSelect(model)}><View style={[styles.modelIcon,{backgroundColor:model.tint}]}><Icon size={20} color={colors.ink}/></View><View style={styles.cardCopy}><Text style={styles.modelType}>{model.type.toUpperCase()} · {model.provider}</Text><Text style={styles.modelName}>{model.name}</Text><Text style={styles.modelDesc}>{model.ready?'Create, explore and turn an idea into something real.':'Waiting for administrator setup.'}</Text></View>{model.ready?<ArrowUpRight size={17} color={colors.muted}/>:<LockKeyhole size={16} color={colors.muted}/>}</TouchableOpacity>})}</>}
function HistoryView({history,models}:{history:ApiGeneration[];models:MobileModel[]}){return <View><Text style={styles.sectionTitle}>History</Text><Text style={styles.sectionSub}>Your latest work across every model.</Text>{history.map(item=><TouchableOpacity disabled={!item.resultUrl} onPress={()=>item.resultUrl&&Linking.openURL(item.resultUrl)} style={mobile.listRow} key={item.id}><View style={mobile.historyDot}/><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{item.title}</Text><Text style={mobile.actionMeta}>{models.find(model=>model.id===item.modelId)?.name||item.modelName||item.modelId} · {item.modelProvider||'Provider'} · {(item.costNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})} · {item.status}</Text>{item.outputText?<Text style={mobile.responseText} numberOfLines={6}>{item.outputText}</Text>:null}</View>{item.resultUrl?<ChevronMark/>:item.status==='queued'?<Clock3 size={15} color={colors.muted}/>:null}</TouchableOpacity>)}</View>}
function UsageView({usage}:{usage:UsageSummary}){
  const limit=Number(usage.budget?.workspaceMonthlyLimitNanoUsd||0)
  const committed=Number(usage.monthlyCommittedNanoUsd||0)
  return <View><Text style={styles.sectionTitle}>Usage</Text><Text style={styles.sectionSub}>Spend is visible to everyone on the team.</Text><View style={mobile.metricCard}><Text style={mobile.metricLabel}>TRACKED TEAM SPEND</Text><Text style={mobile.metricValue}>{(usage.spendNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})}</Text><Text style={mobile.actionMeta}>{usage.calls.toLocaleString()} generations across {usage.byModel.length} models</Text></View><View style={mobile.metricCard}><Text style={mobile.metricLabel}>MONTHLY WORKSPACE BUDGET</Text><Text style={mobile.metricValue}>{limit>0?(limit/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'}):'No cap'}</Text><Text style={mobile.actionMeta}>{(committed/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})} committed this month{limit>0?` · warning at ${usage.budget?.warnAtPercent||80}%`:''}</Text></View>{usage.byModel.map(item=>{const share=usage.spendNanoUsd?Math.round(item.spendNanoUsd/usage.spendNanoUsd*100):0;return <View style={mobile.usageRow} key={item.modelId}><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{item.name}</Text><Text style={mobile.actionMeta}>{share}% of total · {item.calls} calls</Text></View><Text style={mobile.usageCost}>{(item.spendNanoUsd/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})}</Text></View>})}</View>
}
function SettingsView({onLogout}:{onLogout:()=>void}){const [completion,setCompletion]=useState(true);const [weekly,setWeekly]=useState(true);return <View><Text style={styles.sectionTitle}>Settings</Text><Text style={styles.sectionSub}>Your personal Cresco Labs preferences.</Text><SettingToggle icon={Bell} title="Generation completed" detail="Notify me when media is ready" value={completion} onChange={setCompletion}/><SettingToggle icon={Gauge} title="Weekly usage summary" detail="Monday team spend overview" value={weekly} onChange={setWeekly}/><Setting icon={LockKeyhole} title="Privacy & sessions" detail="Current device · Active now"/><Setting icon={Settings} title="Appearance" detail="System theme · Liquid Glass"/><TouchableOpacity style={styles.loginButton} onPress={onLogout}><Text style={styles.loginButtonText}>Log out</Text></TouchableOpacity></View>}
function SettingToggle({icon:Icon,title,detail,value,onChange}:{icon:any,title:string,detail:string,value:boolean,onChange:(value:boolean)=>void}){return <View style={mobile.listRow}><View style={mobile.settingIcon}><Icon size={17} color="#719552"/></View><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{title}</Text><Text style={mobile.actionMeta}>{detail}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{false:'#D9DFDA',true:'#A8CB85'}} thumbColor="#fff"/></View>}
function Setting({icon:Icon,title,detail}:{icon:any,title:string,detail:string}){return <TouchableOpacity style={mobile.listRow}><View style={mobile.settingIcon}><Icon size={17} color="#719552"/></View><View style={styles.cardCopy}><Text style={mobile.actionTitle}>{title}</Text><Text style={mobile.actionMeta}>{detail}</Text></View><ChevronMark/></TouchableOpacity>}
function ChevronMark(){return <Text style={mobile.chevron}>›</Text>}

function Workspace({ model, onBack, onQueued }: { model: MobileModel; onBack: () => void; onQueued: (generation: ApiGeneration) => void }) {
  const [prompt, setPrompt] = useState('')
  const [queued, setQueued] = useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [aspect,setAspect]=useState(model.type==='Image'?'1:1':'16:9')
  const [duration,setDuration]=useState('10 seconds')
  const [references,setReferences]=useState<ApiUpload[]>([])
  const [uploading,setUploading]=useState(false)
  const Icon = model.icon
  const attach=async()=>{setError('');try{const picked=await DocumentPicker.getDocumentAsync({type:model.type==='Image'?'image/*':['image/*','video/*','audio/*'],multiple:true,copyToCacheDirectory:true});if(picked.canceled)return;const available=Math.max(0,5-references.length);if(!available)return setError('You can attach up to five references.');setUploading(true);const uploaded=await Promise.all(picked.assets.slice(0,available).map(asset=>uploadMobileReference({uri:asset.uri,name:asset.name,mimeType:asset.mimeType})));setReferences(items=>[...items,...uploaded.map(item=>item.upload)])}catch(reason){setError(reason instanceof Error?reason.message:'Could not upload this reference.')}finally{setUploading(false)}}
  const generate=async()=>{if(!prompt.trim())return;setBusy(true);setError('');try{const {generation}=await queueGeneration(model.id,prompt.trim(),{aspect,...(model.type==='Video'?{duration}:{})},references.map(item=>item.id));onQueued(generation);setQueued(true)}catch(reason){setError(reason instanceof Error?reason.message:'Could not queue this generation.')}finally{setBusy(false)}}
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back to studio</Text></TouchableOpacity>
      <View style={[styles.workspaceIcon,{backgroundColor:model.tint}]}><Icon size={24} color={colors.ink}/></View>
      <Text style={styles.kicker}>{model.provider} · {model.type} WORKSPACE</Text>
      <Text style={styles.workspaceTitle}>Create with {model.name}</Text>
      <Text style={styles.sub}>{model.type === 'Video' ? 'Describe a scene, movement and mood.' : model.type === 'Text' ? 'Ask a question or describe what you want to make.' : 'Describe the visual you want to create.'}</Text>
      {model.type !== 'Text' && <View style={styles.options}><TouchableOpacity style={styles.optionsTouchable} onPress={()=>setAspect(aspect==='16:9'?'9:16':aspect==='9:16'?'1:1':'16:9')}><Text style={styles.optionsText}>{aspect} ⌄</Text></TouchableOpacity>{model.type==='Video'&&<TouchableOpacity style={styles.optionsTouchable} onPress={()=>setDuration(duration==='5 seconds'?'10 seconds':duration==='10 seconds'?'15 seconds':'5 seconds')}><Text style={styles.optionsText}>{duration} ⌄</Text></TouchableOpacity>}</View>}
      <TextInput style={styles.prompt} multiline placeholder={model.type === 'Video' ? 'Describe your scene...' : 'Start writing your prompt...'} value={prompt} onChangeText={value=>{setPrompt(value);setQueued(false)}}/>
      {model.type!=='Text'&&<><TouchableOpacity disabled={uploading||references.length>=5} style={mobile.uploadButton} onPress={attach}><Upload size={15} color={colors.muted}/><Text style={mobile.uploadText}>{uploading?'Uploading…':`Add reference files · ${references.length}/5`}</Text></TouchableOpacity>{references.map(reference=><View style={mobile.referenceRow} key={reference.id}><View style={styles.cardCopy}><Text style={mobile.actionTitle} numberOfLines={1}>{reference.fileName}</Text><Text style={mobile.actionMeta}>{(reference.size/1024/1024).toFixed(1)} MB</Text></View><TouchableOpacity onPress={()=>setReferences(items=>items.filter(item=>item.id!==reference.id))}><X size={15} color={colors.muted}/></TouchableOpacity></View>)}</>}
      {error?<Text style={styles.loginNote}>{error}</Text>:null}
      {queued&&<View style={mobile.metricCard}><Text style={mobile.actionTitle}>Generation queued</Text><Text style={mobile.actionMeta}>The request and prompt are now recorded in your workspace history.</Text></View>}
      <View style={styles.workspaceFooter}>
        <Text style={styles.cost}>Estimated cost · <Text style={{fontWeight:'700'}}>{model.estimate}</Text></Text>
        <TouchableOpacity disabled={!prompt.trim()||busy||uploading} onPress={generate} style={[styles.generate,(!prompt.trim()||busy||uploading)&&styles.generateDisabled]}><Sparkles size={15} color="#fff"/><Text style={styles.generateText}>{busy?'Queuing…':'Generate'}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </SafeAreaView>
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
    <Text style={styles.label}>EMAIL ADDRESS</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@company.com" autoCapitalize="none" keyboardType="email-address"/>
    <Text style={styles.label}>PASSWORD</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry/>
    {error?<Text style={styles.loginNote}>{error}</Text>:null}
    <TouchableOpacity disabled={!ready||loading} style={[styles.loginButton,(!ready||loading)&&styles.generateDisabled]} onPress={submit}><Text style={styles.loginButtonText}>{loading?'Logging in…':'Log in'}</Text></TouchableOpacity>
    <Text style={styles.loginNote}>Access is invite-only. Your account is created and approved by an admin.</Text>
  </View></SafeAreaView>
}

const styles = StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},splash:{flex:1,alignItems:'center',justifyContent:'center',gap:14},content:{padding:22,paddingTop:35,paddingBottom:40},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},kicker:{fontSize:10,letterSpacing:1.6,fontWeight:'700',color:colors.muted},title:{fontSize:27,fontWeight:'700',color:colors.ink,marginTop:15,letterSpacing:-.8},star:{color:colors.coral},sub:{fontSize:13,color:colors.muted,marginTop:7},avatar:{width:35,height:35,borderRadius:18,backgroundColor:'#D8AA98',alignItems:'center',justifyContent:'center'},pillNav:{alignSelf:'center',flexDirection:'row',padding:4,backgroundColor:colors.glass,borderColor:colors.line,borderWidth:1,borderRadius:radius.pill,marginTop:28,marginBottom:34},navItem:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:12,paddingVertical:9,borderRadius:radius.pill},navSelected:{backgroundColor:colors.glassStrong},navText:{fontSize:11,color:colors.muted},sectionHead:{marginBottom:14},sectionTitle:{fontSize:18,fontWeight:'700',color:colors.ink},sectionSub:{fontSize:12,color:colors.muted,marginTop:5},card:{flexDirection:'row',alignItems:'center',gap:13,padding:15,marginBottom:12,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},cardDisabled:{opacity:.58},modelIcon:{width:42,height:42,borderRadius:13,alignItems:'center',justifyContent:'center'},cardCopy:{flex:1},modelType:{fontSize:9,letterSpacing:1,color:colors.muted},modelName:{fontSize:15,fontWeight:'700',color:colors.ink,marginTop:4},modelDesc:{fontSize:11,color:colors.muted,marginTop:4},empty:{paddingTop:40},login:{margin:22,padding:25,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginTop:80},loginTitle:{fontSize:30,fontWeight:'700',color:colors.ink,marginTop:28},loginSub:{fontSize:13,color:colors.muted,lineHeight:20,marginTop:8,marginBottom:22},label:{fontSize:9,letterSpacing:1,fontWeight:'700',color:colors.muted,marginTop:14,marginBottom:6},input:{backgroundColor:colors.glassStrong,borderWidth:1,borderColor:colors.line,borderRadius:10,padding:13,fontSize:12},loginButton:{marginTop:25,padding:14,alignItems:'center',backgroundColor:colors.ink,borderRadius:11},loginButtonText:{color:'#fff',fontSize:12,fontWeight:'700'},loginNote:{fontSize:10,color:colors.muted,lineHeight:15,marginTop:20},back:{fontSize:12,color:colors.muted,marginBottom:28},workspaceIcon:{width:52,height:52,borderRadius:16,alignItems:'center',justifyContent:'center',marginBottom:18},workspaceTitle:{fontSize:27,fontWeight:'700',color:colors.ink,marginTop:14,marginBottom:7},options:{flexDirection:'row',gap:8,marginTop:24},optionsTouchable:{padding:10},optionsText:{fontSize:11},prompt:{minHeight:150,backgroundColor:colors.glassStrong,borderColor:colors.line,borderWidth:1,borderRadius:radius.card,padding:15,fontSize:13,marginTop:16,textAlignVertical:'top'},workspaceFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:17},cost:{fontSize:10,color:colors.muted},generate:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:colors.ink,paddingHorizontal:14,paddingVertical:11,borderRadius:11},generateDisabled:{opacity:.45},generateText:{fontSize:11,color:'#fff',fontWeight:'700'}})
const mobile=StyleSheet.create({listRow:{flexDirection:'row',alignItems:'center',gap:11,padding:14,marginTop:10,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},historyDot:{width:9,height:9,borderRadius:5,backgroundColor:colors.sage},actionTitle:{fontSize:12,fontWeight:'700',color:colors.ink},actionMeta:{fontSize:10,color:colors.muted,marginTop:4},responseText:{fontSize:11,color:colors.ink,lineHeight:17,marginTop:10},chevron:{fontSize:22,color:colors.muted},metricCard:{padding:20,borderRadius:radius.card,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginTop:20,marginBottom:18},metricLabel:{fontSize:9,letterSpacing:1,color:colors.muted},metricValue:{fontSize:30,fontWeight:'700',color:colors.ink,marginVertical:8},usageRow:{flexDirection:'row',alignItems:'center',paddingVertical:14,borderBottomWidth:1,borderBottomColor:'#ffffffaa'},usageCost:{fontSize:12,fontWeight:'700',color:colors.ink},settingIcon:{width:36,height:36,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:'#e7f1dc'},uploadButton:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:13},uploadText:{fontSize:11,color:colors.muted},referenceRow:{flexDirection:'row',alignItems:'center',padding:11,marginBottom:7,borderRadius:11,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line}})
