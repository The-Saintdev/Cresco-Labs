import { useCallback, useEffect, useState } from 'react'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { VideoView, useVideoPlayer } from 'expo-video'
import { Image, Linking, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ArrowDownToLine, Check, ChevronRight, CreditCard, Gauge, KeyRound, LockKeyhole, Plus, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react-native'
import { radius } from '@cresco/mobile-shared/tokens'
import {
  createModel as apiCreateModel, createUser as apiCreateUser, deleteModel as apiDeleteModel,
  clearMobileSession, getAdminWorkspace, login as apiLogin, reconcileProviderData, restoreMobileSession, setProviderCredential, updateBudgetPolicy, updateModel as apiUpdateModel, updateUser as apiUpdateUser,
  type ApiBalance, type ApiGeneration, type ApiModel, type ApiProvider, type ApiUser, type AuditEvent, type BudgetPolicy, type UsageSummary,
} from '@cresco/mobile-shared/api'

type AdminData = { users: ApiUser[]; models: ApiModel[]; usage: UsageSummary; events: AuditEvent[]; balances: ApiBalance[]; generations: ApiGeneration[]; providers: ApiProvider[] }
const colors={ink:'#F7F8F6',background:'#07090A',glass:'rgba(20,24,25,0.88)',glassStrong:'rgba(31,36,37,0.96)',line:'rgba(255,255,255,0.10)',sage:'#B8E986',coral:'#F39A7A',lilac:'#B7A7D5',blue:'#77B8D1',sand:'#E2BE72',muted:'#A5AEAA'}
const emptyData: AdminData = { users: [], models: [], usage: { spendNanoUsd: 0, calls: 0, byModel: [], balances: [] }, events: [], balances: [], generations: [], providers: [] }
const money=(nano:number)=>(nano/1_000_000_000).toLocaleString('en-US',{style:'currency',currency:'USD'})
export default function App(){
  const [tab,setTab]=useState('Overview')
  const [loggedIn,setLoggedIn]=useState(false)
  const [restoring,setRestoring]=useState(true)
  const [data,setData]=useState<AdminData>(emptyData)
  const [error,setError]=useState('')
  const [refreshing,setRefreshing]=useState(false)
  const refresh=useCallback(async()=>{const next=await getAdminWorkspace();setData(next);setError('')},[])
  const pullRefresh=useCallback(async()=>{setRefreshing(true);try{await refresh()}catch(reason){setError(reason instanceof Error?reason.message:'Could not refresh the control room.')}finally{setRefreshing(false)}},[refresh])
  useEffect(()=>{
    if(!loggedIn)return
    const timer=setInterval(()=>void refresh().catch(reason=>setError(reason instanceof Error?reason.message:'Could not refresh the control room.')),10000)
    return()=>clearInterval(timer)
  },[loggedIn,refresh])
  useEffect(()=>{
    let active=true
    restoreMobileSession().then(async session=>{
      if(!active||!session)return
      if(session.user.role!=='admin'){await clearMobileSession();return}
      await refresh()
      if(active)setLoggedIn(true)
    }).catch(()=>void clearMobileSession()).finally(()=>{if(active)setRestoring(false)})
    return()=>{active=false}
  },[refresh])
  if(restoring)return <SafeAreaView style={s.safe}><View style={auth.splash}><ShieldCheck size={22} color={colors.ink}/><Text style={s.kicker}>CRESCO ADMIN</Text></View></SafeAreaView>
  if(!loggedIn)return <AdminLogin onLogin={async (email,password)=>{const session=await apiLogin(email,password,'admin-mobile');if(session.user.role!=='admin'){await clearMobileSession();throw new Error('Administrator access is required.')}await refresh();setLoggedIn(true)}}/>
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullRefresh} tintColor={colors.sage} colors={[colors.sage]} progressBackgroundColor="#111516"/>}>
    <View style={s.header}><View><Text style={s.kicker}>CRESCO ADMIN</Text><Text style={s.title}>Control room</Text><Text style={s.sub}>Private workspace administration.</Text></View><TouchableOpacity style={s.secure} onPress={()=>{void clearMobileSession();setLoggedIn(false)}}><ShieldCheck size={17} color={colors.sage}/><Text style={s.secureText}>Log out</Text></TouchableOpacity></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.nav}>{['Overview','Models','People','Usage','Activity'].map(x=><TouchableOpacity key={x} style={[s.navItem,tab===x&&s.navSelected]} onPress={()=>setTab(x)}><Text style={[s.navText,tab===x&&s.navTextSelected]}>{x}</Text></TouchableOpacity>)}</ScrollView>
    {error?<Text style={auth.note}>{error}</Text>:null}
    {tab==='Overview'?<Overview data={data} onNavigate={setTab}/>:tab==='Models'?<AddModel models={data.models} providers={data.providers} refresh={refresh} onError={setError}/>:tab==='People'?<People users={data.users} refresh={refresh} onError={setError}/>:tab==='Usage'?<Usage data={data} refresh={refresh} onError={setError}/>:<Activity data={data}/>} 
  </ScrollView></SafeAreaView>
}
function AdminLogin({onLogin}:{onLogin:(email:string,password:string)=>Promise<void>}){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const ready=email.trim().length>0&&password.trim().length>0
  const submit=async()=>{setLoading(true);setError('');try{await onLogin(email,password)}catch(reason){setError(reason instanceof Error?reason.message:'Login failed.')}finally{setLoading(false)}}
  return <SafeAreaView style={s.safe}><View style={auth.card}><View style={auth.lock}><LockKeyhole size={22} color="#071009"/></View><Text style={s.kicker}>CRESCO ADMIN</Text><Text style={auth.title}>Administrator login</Text><Text style={auth.sub}>This app is restricted to the Cresco Labs workspace owner.</Text><Text style={s.label}>ADMIN EMAIL</Text><TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="admin@company.com" placeholderTextColor={colors.muted} selectionColor={colors.sage}/><Text style={s.label}>PASSWORD</Text><TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Enter your password" placeholderTextColor={colors.muted} selectionColor={colors.sage}/>{error?<Text style={auth.note}>{error}</Text>:null}<TouchableOpacity disabled={!ready||loading} style={[s.primary,(!ready||loading)&&admin.disabled]} onPress={submit}><ShieldCheck size={18} color="#071009"/><Text style={s.primaryText}>{loading?'Logging in…':'Log in securely'}</Text></TouchableOpacity><Text style={auth.note}>There is no sign-up flow. Admin access is provisioned directly.</Text></View></SafeAreaView>
}
function Overview({data,onNavigate}:{data:AdminData;onNavigate:(tab:string)=>void}){
  const pending=data.users.filter(user=>user.status==='pending').length
  const actions=[['Review access requests',`${pending} people are waiting for approval`,'People'],['Add a model','Connect a text, image or video provider','Models'],['Review usage','Track spend across the workspace','Usage']]
  return <><View style={s.metrics}><Metric label="Tracked spend" value={money(data.usage.spendNanoUsd)}/><Metric label="Pending approvals" value={String(pending)}/><Metric label="API calls" value={data.usage.calls.toLocaleString()}/></View><Text style={s.sectionTitle}>Quick actions</Text>{actions.map(([title,detail,destination])=><TouchableOpacity style={s.action} key={title} onPress={()=>onNavigate(destination)}><View style={s.actionIcon}><Gauge size={17} color="#729a52"/></View><View style={s.copy}><Text style={s.actionTitle}>{title}</Text><Text style={s.actionDetail}>{detail}</Text></View><ChevronRight size={17} color={colors.muted}/></TouchableOpacity>)}</>
}
function Metric({label,value}:{label:string,value:string}){return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{value}</Text></View>}
function AddModel({models,providers,refresh,onError}:{models:ApiModel[];providers:ApiProvider[];refresh:()=>Promise<void>;onError:(message:string)=>void}){
  const [vaultProvider,setVaultProvider]=useState('fal.ai')
  const [vaultKey,setVaultKey]=useState('')
  const [vaultBusy,setVaultBusy]=useState(false)
  const [kind,setKind]=useState('Text')
  const [name,setName]=useState('')
  const [description,setDescription]=useState('')
  const [provider,setProvider]=useState('')
  const [endpoint,setEndpoint]=useState('')
  const [thinkingMode,setThinkingMode]=useState<'disabled'|'enabled'|'auto'>('disabled')
  const [textApi,setTextApi]=useState<'chat_completions'|'responses'>('chat_completions')
  const [price,setPrice]=useState('')
  const [apiKey,setApiKey]=useState('')
  const [busy,setBusy]=useState(false)
  const [editingId,setEditingId]=useState('')
  const normalizeProvider=(value:string)=>{const key=value.trim().toLowerCase();if(key.includes('fal.ai')||key==='fal')return 'fal.ai';if(key.includes('openai'))return 'openai';if(key.includes('anthropic'))return 'anthropic';if(key.includes('google'))return 'google';return key}
  const providerAlreadySecured=providers.some(item=>normalizeProvider(item.provider)===normalizeProvider(provider))
  const ready=Boolean(name.trim()&&provider.trim()&&endpoint.trim()&&(editingId||apiKey.trim()||providerAlreadySecured)&&Number(price)>=0)
  const clearForm=()=>{setEditingId('');setKind('Text');setName('');setDescription('');setProvider('');setEndpoint('');setPrice('');setThinkingMode('disabled');setTextApi('chat_completions');setApiKey('')}
  const beginEdit=(model:ApiModel)=>{setEditingId(model.id);setKind(model.kind[0].toUpperCase()+model.kind.slice(1));setName(model.name);setDescription(model.description||'');setProvider(model.provider);setEndpoint(model.endpoint||'');setPrice(String(Number(model.priceNanoUsd||0)/1_000_000_000));setThinkingMode(model.thinkingMode||'disabled');setTextApi(model.textApi||'chat_completions');setApiKey('')}
  const add=async()=>{
    if(!ready)return
    setBusy(true);onError('')
    try{const input={name:name.trim(),description:description.trim(),provider:provider.trim(),endpoint:endpoint.trim(),apiKey:apiKey.trim()||undefined,priceUsd:Number(price),kind:kind.toLowerCase() as ApiModel['kind'],...(kind==='Text'?{thinkingMode,textApi}:{})};if(editingId)await apiUpdateModel(editingId,input);else await apiCreateModel({...input,status:'active'});await refresh();clearForm()}
    catch(reason){onError(reason instanceof Error?reason.message:'Could not save model.')}
    finally{setBusy(false)}
  }
  const remove=async(id:string)=>{try{await apiDeleteModel(id);await refresh()}catch(reason){onError(reason instanceof Error?reason.message:'Could not remove model.')}}
  const toggle=async(model:ApiModel)=>{try{await apiUpdateModel(model.id,{status:model.status==='disabled'?'active':'disabled'});await refresh()}catch(reason){onError(reason instanceof Error?reason.message:'Could not update model.')}}
  const secureKey=async()=>{if(!vaultProvider.trim()||!vaultKey.trim())return;setVaultBusy(true);try{await setProviderCredential(vaultProvider.trim(),vaultKey.trim());await refresh();setVaultKey('')}catch(reason){onError(reason instanceof Error?reason.message:'Could not secure provider key.')}finally{setVaultBusy(false)}}
  return <View>
    <Text style={s.sectionTitle}>Provider vault</Text>
    <Text style={s.sectionSub}>Secure one provider key and reuse it across that provider’s models.</Text>
    {providers.map(item=><View style={s.action} key={item.provider}><View style={s.actionIcon}><ShieldCheck size={17} color="#729a52"/></View><View style={s.copy}><Text style={s.actionTitle}>{item.provider}</Text><Text style={s.actionDetail}>Credential secured · updated {new Date(item.updatedAt).toLocaleDateString()}</Text></View></View>)}
    <Field label="PROVIDER" placeholder="e.g. fal.ai" value={vaultProvider} onChange={setVaultProvider}/>
    <Text style={s.label}>API KEY</Text><View style={s.keyInput}><KeyRound size={18} color={colors.muted}/><TextInput style={s.keyText} value={vaultKey} onChangeText={setVaultKey} placeholder="Encrypted on the backend" placeholderTextColor={colors.muted} selectionColor={colors.sage} secureTextEntry/></View>
    <TouchableOpacity disabled={vaultBusy||!vaultProvider.trim()||!vaultKey.trim()} onPress={secureKey} style={[s.primary,(vaultBusy||!vaultProvider.trim()||!vaultKey.trim())&&admin.disabled]}><ShieldCheck size={16} color="#fff"/><Text style={s.primaryText}>{vaultBusy?'Securing…':'Secure provider key'}</Text></TouchableOpacity>
    <Text style={[s.sectionTitle,{marginTop:34}]}>{editingId?'Edit model':'Add model'}</Text>
    <Text style={s.sectionSub}>Connect a provider endpoint and choose the interface your team will see.</Text>
    <View style={admin.typeRow}>{['Text','Image','Video'].map(x=><TouchableOpacity key={x} style={[admin.typeChoice,kind===x&&admin.typeSelected]} onPress={()=>setKind(x)}><Text style={admin.typeText}>{x}</Text></TouchableOpacity>)}</View>
    <Field label="DISPLAY NAME" placeholder="e.g. Seedance 2.0" value={name} onChange={setName}/>
    <Field label="DESCRIPTION" placeholder="What this model is best used for" value={description} onChange={setDescription}/>
    <Field label="PROVIDER" placeholder="e.g. fal.ai" value={provider} onChange={setProvider}/>
    <Field label="ENDPOINT ID" placeholder="provider/model/endpoint" value={endpoint} onChange={setEndpoint}/>
    {kind==='Text'?<>
      <Text style={s.sectionSub}>Reasoning adds latency and billed tokens. Leave it off unless this model needs it.</Text>
      <View style={admin.typeRow}>{([['disabled','No reasoning'],['enabled','Reasoning on'],['auto','Provider default']] as const).map(([value,label])=><TouchableOpacity key={value} style={[admin.typeChoice,thinkingMode===value&&admin.typeSelected]} onPress={()=>setThinkingMode(value)}><Text style={admin.typeText}>{label}</Text></TouchableOpacity>)}</View>
      <Text style={s.sectionSub}>Chat completions is the standard text endpoint. Switch only to compare latency.</Text>
      <View style={admin.typeRow}>{([['chat_completions','Chat completions'],['responses','Responses API']] as const).map(([value,label])=><TouchableOpacity key={value} style={[admin.typeChoice,textApi===value&&admin.typeSelected]} onPress={()=>setTextApi(value)}><Text style={admin.typeText}>{label}</Text></TouchableOpacity>)}</View>
    </>:null}
    <Field label="ESTIMATED COST PER RUN (USD)" placeholder="e.g. 0.62" value={price} onChange={setPrice}/>
    <Text style={s.label}>API KEY</Text>
    <View style={s.keyInput}><KeyRound size={18} color={colors.muted}/><TextInput style={s.keyText} value={apiKey} onChangeText={setApiKey} placeholder={providerAlreadySecured?'Using secured provider key':'Encrypted on the backend'} placeholderTextColor={colors.muted} selectionColor={colors.sage} secureTextEntry/></View>
    <Text style={s.sectionSub}>{providerAlreadySecured?'This model will reuse the key already secured for this provider.':'Enter a key here or secure it once in the provider vault above.'}</Text>
    <TouchableOpacity disabled={!ready||busy} onPress={add} style={[s.primary,(!ready||busy)&&admin.disabled]}><Plus size={16} color="#fff"/><Text style={s.primaryText}>{busy?'Saving…':editingId?'Save model changes':`Connect ${kind.toLowerCase()} model`}</Text></TouchableOpacity>
    {editingId?<TouchableOpacity onPress={clearForm} style={s.approve}><Text>Cancel editing</Text></TouchableOpacity>:null}
    <Text style={[s.sectionTitle,{marginTop:34}]}>Connected models</Text>
    {models.map(model=><View style={s.action} key={model.id}><View style={s.actionIcon}>{model.executionReady?<ShieldCheck size={17} color="#729a52"/>:<KeyRound size={17} color="#A56D61"/>}</View><View style={s.copy}><Text style={s.actionTitle}>{model.name}</Text><Text style={s.actionDetail}>{model.provider} · {model.kind} · {model.status} · {model.executionReady?'Ready':!model.credentialConfigured?'Key required':'Adapter required'}{model.priceNanoUsd?` · ${money(model.priceNanoUsd)}/run`:''}</Text></View><TouchableOpacity style={admin.activeBadge} onPress={()=>beginEdit(model)}><Text style={admin.activeText}>Edit</Text></TouchableOpacity><TouchableOpacity style={admin.activeBadge} onPress={()=>toggle(model)}><Text style={admin.activeText}>{model.status==='disabled'?'Publish':'Disable'}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={'Archive '+model.name} onPress={()=>remove(model.id)}><Trash2 size={16} color="#A56D61"/></TouchableOpacity></View>)}
  </View>
}
function Field({label,placeholder,value,onChange,secure=false}:{label:string;placeholder:string;value:string;onChange:(value:string)=>void;secure?:boolean}){return <><Text style={s.label}>{label}</Text><TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} selectionColor={colors.sage} secureTextEntry={secure} autoCapitalize={label.includes('EMAIL')?'none':'sentences'}/></>}
function People({users,refresh,onError}:{users:ApiUser[];refresh:()=>Promise<void>;onError:(message:string)=>void}){
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [newStatus,setNewStatus]=useState<'active'|'pending'>('active')
  const [busy,setBusy]=useState(false)
  const [resetId,setResetId]=useState('')
  const [resetPassword,setResetPassword]=useState('')
  const pending=users.filter(user=>user.status==='pending')
  const members=users.filter(user=>user.status==='active')
  const changeStatus=async(id:string,status:'active'|'suspended')=>{try{await apiUpdateUser(id,{status});await refresh()}catch(reason){onError(reason instanceof Error?reason.message:'Could not update access.')}}
  const add=async()=>{if(!name.trim()||!email.trim()||!password.trim())return;setBusy(true);try{await apiCreateUser({name:name.trim(),email:email.trim(),password,status:newStatus});await refresh();setName('');setEmail('');setPassword('')}catch(reason){onError(reason instanceof Error?reason.message:'Could not create member.')}finally{setBusy(false)}}
  const reset=async()=>{if(!resetId||resetPassword.length<10)return;setBusy(true);try{await apiUpdateUser(resetId,{password:resetPassword});await refresh();setResetId('');setResetPassword('')}catch(reason){onError(reason instanceof Error?reason.message:'Could not reset this password.')}finally{setBusy(false)}}
  return <View>
    <Text style={s.sectionTitle}>Access requests</Text>
    <Text style={s.sectionSub}>{pending.length} people waiting for approval.</Text>
    {pending.map(user=><View style={s.person} key={user.id}><Avatar name={user.name}/><View style={s.copy}><Text style={s.actionTitle}>{user.name}</Text><Text style={s.actionDetail}>{user.email} · Waiting for approval</Text></View><TouchableOpacity accessibilityLabel={'Decline '+user.name} onPress={()=>changeStatus(user.id,'suspended')}><X size={16} color="#A56D61"/></TouchableOpacity><TouchableOpacity style={s.approve} onPress={()=>changeStatus(user.id,'active')}><Check size={14} color="#52713D"/><Text>Approve</Text></TouchableOpacity></View>)}
    <Text style={[s.sectionTitle,{marginTop:28}]}>Add a team member</Text>
    <Text style={s.sectionSub}>Create the login yourself. Cresco has no public sign-up.</Text>
    <Field label="FULL NAME" placeholder="Team member name" value={name} onChange={setName}/>
    <Field label="EMAIL ADDRESS" placeholder="name@company.com" value={email} onChange={setEmail}/>
    <Field label="TEMPORARY PASSWORD" placeholder="Set an initial password" value={password} onChange={setPassword} secure/>
    <View style={[admin.typeRow,{marginTop:18}]}>{(['active','pending'] as const).map(status=><TouchableOpacity key={status} style={[admin.typeChoice,newStatus===status&&admin.typeSelected]} onPress={()=>setNewStatus(status)}><Text style={admin.typeText}>{status==='active'?'Approve now':'Needs approval'}</Text></TouchableOpacity>)}</View>
    <TouchableOpacity disabled={busy||!name.trim()||!email.trim()||!password.trim()} onPress={add} style={[s.primary,(busy||!name.trim()||!email.trim()||!password.trim())&&admin.disabled]}><Users size={16} color="#fff"/><Text style={s.primaryText}>{busy?'Creating…':'Create member login'}</Text></TouchableOpacity>
    <Text style={[s.sectionTitle,{marginTop:28}]}>Approved members</Text>
    {members.map(user=><View key={user.id}><View style={s.person}><Avatar name={user.name}/><View style={s.copy}><Text style={s.actionTitle}>{user.name}</Text><Text style={s.actionDetail}>{user.email} · {user.role}</Text></View>{user.role==='member'?<><TouchableOpacity style={admin.activeBadge} onPress={()=>{setResetId(user.id);setResetPassword('')}}><Text style={admin.activeText}>Reset</Text></TouchableOpacity><TouchableOpacity style={admin.activeBadge} onPress={()=>changeStatus(user.id,'suspended')}><Text style={admin.activeText}>Disable</Text></TouchableOpacity></>:<View style={admin.activeBadge}><Text style={admin.activeText}>Owner</Text></View>}</View>{resetId===user.id&&<View style={admin.resetPanel}><Text style={s.actionTitle}>New temporary password for {user.name}</Text><TextInput style={s.input} value={resetPassword} onChangeText={setResetPassword} secureTextEntry placeholder="At least 10 characters" placeholderTextColor={colors.muted} selectionColor={colors.sage}/><TouchableOpacity disabled={busy||resetPassword.length<10} onPress={reset} style={[s.primary,(busy||resetPassword.length<10)&&admin.disabled]}><KeyRound size={17} color="#071009"/><Text style={s.primaryText}>{busy?'Resetting…':'Reset password'}</Text></TouchableOpacity></View>}</View>)}
  </View>
}

function Avatar({name}:{name:string}){return <View style={s.avatar}><Text>{name.split(' ').map(part=>part[0]).join('')}</Text></View>}
function Usage({data,refresh,onError}:{data:AdminData;refresh:()=>Promise<void>;onError:(message:string)=>void}){
  const credits=data.balances.reduce((sum,item)=>sum+item.amountNanoUsd,0)
  const [syncing,setSyncing]=useState(false)
  const [syncNote,setSyncNote]=useState('')
  const sync=async()=>{setSyncing(true);setSyncNote('');onError('');try{const result=await reconcileProviderData();await refresh();setSyncNote(result.providerSync.configured?`Synced ${result.providerSync.reconciledCosts||0} exact request costs and the latest provider balance.`:'Add a fal.ai key in Models to enable provider billing sync.')}catch(reason){onError(reason instanceof Error?reason.message:'Could not sync provider data.')}finally{setSyncing(false)}}
  return <View><Text style={s.sectionTitle}>Usage & balances</Text><Text style={s.sectionSub}>Provider balances, team spend and model-level costs.</Text><View style={s.metrics}><Metric label="Tracked spend" value={money(data.usage.spendNanoUsd)}/><Metric label="Credits remaining" value={money(credits)}/><Metric label="Total calls" value={data.usage.calls.toLocaleString()}/></View><TouchableOpacity disabled={syncing} onPress={sync} style={[s.primary,syncing&&admin.disabled]}><Gauge size={16} color="#fff"/><Text style={s.primaryText}>{syncing?'Syncing fal billing…':'Sync provider billing now'}</Text></TouchableOpacity>{syncNote?<Text style={auth.note}>{syncNote}</Text>:null}<Text style={[s.sectionTitle,{marginTop:28}]}>Fund providers</Text><Text style={s.sectionSub}>Payments stay in each provider’s secure billing console.</Text><TouchableOpacity style={s.action} onPress={()=>void Linking.openURL('https://fal.ai/dashboard/billing')}><View style={s.actionIcon}><CreditCard size={17} color="#729a52"/></View><View style={s.copy}><Text style={s.actionTitle}>Add fal credits</Text><Text style={s.actionDetail}>Open the official fal billing dashboard</Text></View><ChevronRight size={17} color={colors.muted}/></TouchableOpacity><TouchableOpacity style={s.action} onPress={()=>void Linking.openURL('https://console.byteplus.com/finance')}><View style={s.actionIcon}><CreditCard size={17} color="#729a52"/></View><View style={s.copy}><Text style={s.actionTitle}>Fund BytePlus</Text><Text style={s.actionDetail}>Open the official BytePlus Billing Center</Text></View><ChevronRight size={17} color={colors.muted}/></TouchableOpacity><BudgetEditor policy={data.usage.budget} committed={data.usage.monthlyCommittedNanoUsd||0} refresh={refresh} onError={onError}/><Text style={[s.sectionTitle,{marginTop:28}]}>Provider balances</Text>{data.balances.map(balance=><View style={s.action} key={balance.provider}><View style={s.actionIcon}><CreditCard size={17} color="#729a52"/></View><View style={s.copy}><Text style={s.actionTitle}>{balance.provider}</Text><Text style={s.actionDetail}>{balance.source==='provider'?'Live provider balance':'Internal ledger'} · {new Date(balance.syncedAt).toLocaleDateString()}</Text></View><Text style={admin.auditCost}>{money(balance.amountNanoUsd)}</Text></View>)}{data.usage.providerUsage?<><Text style={[s.sectionTitle,{marginTop:28}]}>Provider account usage</Text><Text style={s.sectionSub}>Current-month fal billing, including activity outside Cresco.</Text>{data.usage.providerUsage.byEndpoint.map(item=><View style={admin.audit} key={`${item.provider}:${item.endpointId}`}><View style={s.copy}><Text style={s.actionTitle}>{item.endpointId}</Text><Text style={s.actionDetail}>{item.provider} · {item.quantity.toLocaleString()} billed units</Text></View><Text style={admin.auditCost}>{money(item.spendNanoUsd)}</Text></View>)}</>:null}<Text style={[s.sectionTitle,{marginTop:28}]}>Spend by model</Text>{data.usage.byModel.map(item=><View style={admin.audit} key={item.modelId}><View style={s.copy}><Text style={s.actionTitle}>{item.name}</Text><Text style={s.actionDetail}>{item.provider} · {item.calls} calls</Text></View><Text style={admin.auditCost}>{money(item.spendNanoUsd)}</Text></View>)}<Text style={[s.sectionTitle,{marginTop:28}]}>Spend by member</Text>{(data.usage.byMember||[]).map(item=><View style={admin.audit} key={item.email}><View style={s.copy}><Text style={s.actionTitle}>{item.email}</Text><Text style={s.actionDetail}>{item.calls} calls</Text></View><Text style={admin.auditCost}>{money(item.spendNanoUsd)}</Text></View>)}</View>
}
function BudgetEditor({policy,committed,refresh,onError}:{policy?:BudgetPolicy;committed:number;refresh:()=>Promise<void>;onError:(message:string)=>void}){
  const [monthly,setMonthly]=useState(String((policy?.workspaceMonthlyLimitNanoUsd||0)/1_000_000_000))
  const [perRun,setPerRun]=useState(String((policy?.perGenerationLimitNanoUsd||0)/1_000_000_000))
  const [warning,setWarning]=useState(String(policy?.warnAtPercent||80))
  const [busy,setBusy]=useState(false)
  useEffect(()=>{setMonthly(String((policy?.workspaceMonthlyLimitNanoUsd||0)/1_000_000_000));setPerRun(String((policy?.perGenerationLimitNanoUsd||0)/1_000_000_000));setWarning(String(policy?.warnAtPercent||80))},[policy?.workspaceMonthlyLimitNanoUsd,policy?.perGenerationLimitNanoUsd,policy?.warnAtPercent])
  const limit=Number(monthly||0)*1_000_000_000
  const percent=limit>0?Math.min(100,Math.round(committed/limit*100)):0
  const save=async()=>{setBusy(true);try{await updateBudgetPolicy({workspaceMonthlyLimitUsd:Number(monthly||0),perGenerationLimitUsd:Number(perRun||0),warnAtPercent:Number(warning||80)});await refresh()}catch(reason){onError(reason instanceof Error?reason.message:'Could not save budget controls.')}finally{setBusy(false)}}
  return <View style={admin.budgetCard}><Text style={s.sectionTitle}>Spend controls</Text><Text style={s.sectionSub}>Set 0 for no hard limit. Work in progress reserves its estimated cost.</Text><View style={admin.budgetProgress}><View style={[admin.budgetFill,{width:`${percent}%`}]}/></View><Text style={s.actionDetail}>{money(committed)} committed this month · {limit>0?`${percent}% of ${money(limit)}`:'No monthly cap'}</Text><Field label="MONTHLY WORKSPACE LIMIT (USD)" placeholder="0" value={monthly} onChange={setMonthly}/><Field label="MAXIMUM PER GENERATION (USD)" placeholder="0" value={perRun} onChange={setPerRun}/><Field label="WARNING THRESHOLD (%)" placeholder="80" value={warning} onChange={setWarning}/><TouchableOpacity disabled={busy} onPress={save} style={[s.primary,busy&&admin.disabled]}><Gauge size={16} color="#fff"/><Text style={s.primaryText}>{busy?'Saving…':'Save spend controls'}</Text></TouchableOpacity></View>
}
function Activity({data}:{data:AdminData}){
  const [selectedId,setSelectedId]=useState<string|null>(null)
  return <View><Text style={s.sectionTitle}>Calls & audit</Text><Text style={s.sectionSub}>Every member, prompt, model, status, result and cost.</Text>{data.generations.map(item=>{
    const selected=selectedId===item.id
    const hasDetails=Boolean(item.outputText||item.resultUrl||item.error)
    return <View style={resultUi.activityCard} key={item.id}><View style={resultUi.activityHeader}><View style={s.copy}><Text style={s.actionTitle}>{item.title}</Text><Text style={s.actionDetail}>{item.userEmail} · {data.models.find(model=>model.id===item.modelId)?.name||item.modelName||item.modelId} · {item.status==='queued'?'Processing':item.status==='complete'?'Complete':'Failed'} · {new Date(item.createdAt).toLocaleString()}</Text><Text style={s.actionDetail}>{item.prompt}</Text><Text style={s.actionDetail}>{item.costSource==='provider'?'Provider confirmed':item.costSource==='catalog_estimate'?'Catalog estimate':'Pending reconciliation'}{item.references?.length?` · ${item.references.length} reference${item.references.length===1?'':'s'}`:''}</Text>{hasDetails?<TouchableOpacity style={admin.resultLink} onPress={()=>setSelectedId(value=>value===item.id?null:item.id)}><Text style={admin.resultLinkText}>{selected?'Hide result':'Show result in app'}</Text><ChevronRight size={15} color={colors.sage} style={selected?resultUi.chevronOpen:undefined}/></TouchableOpacity>:null}</View><Text style={admin.auditCost}>{money(item.costNanoUsd)}</Text></View>{selected?<AdminResult generation={item}/>:null}</View>
  })}<Text style={[s.sectionTitle,{marginTop:28}]}>Administrative audit</Text>{data.events.map(event=><View style={admin.audit} key={event.id}><View style={s.copy}><Text style={s.actionTitle}>{event.action}</Text><Text style={s.actionDetail}>{event.actorEmail} · {new Date(event.createdAt).toLocaleString()}</Text></View></View>)}</View>
}

function AdminResult({generation}:{generation:ApiGeneration}){
  const [saving,setSaving]=useState(false)
  const [saveError,setSaveError]=useState('')
  const save=async()=>{if(!generation.resultUrl)return;setSaving(true);setSaveError('');try{const clean=generation.resultUrl.split('?')[0];const fallback=generation.kind==='video'?'mp4':'png';const ext=clean.split('.').pop()?.slice(0,5)||fallback;const target=FileSystem.cacheDirectory+`cresco-${generation.id}.${ext}`;const downloaded=await FileSystem.downloadAsync(generation.resultUrl,target);if(!(await Sharing.isAvailableAsync()))throw new Error('Saving is not available on this device.');await Sharing.shareAsync(downloaded.uri,{dialogTitle:'Save Cresco result'})}catch(reason){setSaveError(reason instanceof Error?reason.message:'Could not save this result.')}finally{setSaving(false)}}
  return <View style={resultUi.viewer}><View style={resultUi.viewerHead}><Sparkles size={19} color={colors.sage}/><View style={s.copy}><Text style={resultUi.viewerTitle}>{generation.status==='failed'?'Request failed':'Generated result'}</Text><Text style={resultUi.viewerMeta}>{generation.status==='failed'?'Provider response and error details':'Previewed securely inside Cresco Admin'}</Text></View></View>{generation.error?<Text style={resultUi.errorText}>{generation.error}</Text>:null}{generation.outputText?<Text selectable style={resultUi.outputText}>{generation.outputText}</Text>:null}{generation.resultUrl&&generation.kind==='image'?<Image source={{uri:generation.resultUrl}} resizeMode="contain" style={resultUi.image}/>:null}{generation.resultUrl&&generation.kind==='video'?<AdminVideo url={generation.resultUrl}/>:null}{saveError?<Text style={resultUi.errorText}>{saveError}</Text>:null}{generation.resultUrl?<TouchableOpacity disabled={saving} style={resultUi.download} onPress={save}><ArrowDownToLine size={17} color="#071009"/><Text style={resultUi.downloadText}>{saving?'Preparing…':'Download / save'}</Text></TouchableOpacity>:null}</View>
}

function AdminVideo({url}:{url:string}){
  const player=useVideoPlayer(url,instance=>{instance.loop=false})
  return <VideoView player={player} nativeControls contentFit="contain" style={resultUi.video}/>
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},content:{padding:24,paddingTop:30,paddingBottom:64},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:16},kicker:{fontSize:12,letterSpacing:1.8,fontWeight:'800',color:colors.sage},title:{fontSize:34,fontWeight:'800',color:colors.ink,marginTop:12,letterSpacing:-1},sub:{fontSize:15,color:colors.muted,marginTop:7,lineHeight:22},secure:{flexDirection:'row',alignItems:'center',gap:7,backgroundColor:colors.glass,paddingHorizontal:13,paddingVertical:10,borderRadius:radius.pill,minHeight:44,borderWidth:1,borderColor:colors.line},secureText:{fontSize:13,fontWeight:'700',color:colors.ink},nav:{alignSelf:'center',flexDirection:'row',padding:5,backgroundColor:'#111516',borderColor:colors.line,borderWidth:1,borderRadius:radius.pill,marginTop:30,marginBottom:36},navItem:{paddingHorizontal:16,paddingVertical:12,borderRadius:radius.pill,minHeight:44,justifyContent:'center'},navSelected:{backgroundColor:'#293229'},navText:{fontSize:13,fontWeight:'600',color:colors.muted},navTextSelected:{color:colors.ink},metrics:{gap:12,marginBottom:36},metric:{padding:21,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},metricLabel:{fontSize:13,color:colors.muted},metricValue:{fontSize:29,fontWeight:'800',color:colors.ink,marginTop:9},sectionTitle:{fontSize:23,fontWeight:'800',color:colors.ink,marginBottom:15,letterSpacing:-.3},sectionSub:{fontSize:14,color:colors.muted,lineHeight:21,marginTop:-8,marginBottom:24},action:{flexDirection:'row',alignItems:'center',gap:14,padding:18,minHeight:74,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginBottom:12},actionIcon:{width:44,height:44,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:'#243023'},copy:{flex:1},actionTitle:{fontSize:15,fontWeight:'700',color:colors.ink,lineHeight:20},actionDetail:{fontSize:13,color:colors.muted,marginTop:5,lineHeight:18},label:{fontSize:11,fontWeight:'800',letterSpacing:1.15,color:'#B8C0BC',marginTop:21,marginBottom:8},input:{minHeight:54,color:colors.ink,backgroundColor:colors.glassStrong,borderWidth:1,borderColor:colors.line,borderRadius:13,paddingHorizontal:16,paddingVertical:14,fontSize:16},keyInput:{minHeight:54,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.glassStrong,borderWidth:1,borderColor:colors.line,borderRadius:13,paddingHorizontal:15},keyText:{flex:1,color:colors.ink,fontSize:16,paddingVertical:14},primary:{marginTop:27,minHeight:54,backgroundColor:'#31533A',borderRadius:13,paddingHorizontal:17,paddingVertical:15,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,borderWidth:1,borderColor:'#5F8668'},primaryText:{color:'#FFFFFF',fontWeight:'800',fontSize:15},person:{flexDirection:'row',alignItems:'center',gap:13,padding:17,minHeight:72,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginBottom:12},avatar:{width:44,height:44,borderRadius:22,backgroundColor:colors.coral,alignItems:'center',justifyContent:'center'},approve:{backgroundColor:colors.sage,paddingHorizontal:13,paddingVertical:10,minHeight:40,justifyContent:'center',borderRadius:10}})
const auth=StyleSheet.create({splash:{flex:1,alignItems:'center',justifyContent:'center',gap:16},card:{margin:18,marginTop:58,padding:28,borderRadius:24,backgroundColor:'#111516F2',borderWidth:1,borderColor:colors.line,shadowColor:'#000',shadowOpacity:.48,shadowRadius:28,shadowOffset:{width:0,height:18}},lock:{width:52,height:52,borderRadius:16,backgroundColor:colors.sage,alignItems:'center',justifyContent:'center',marginBottom:27},title:{fontSize:33,fontWeight:'800',color:colors.ink,marginTop:16,letterSpacing:-.7},sub:{fontSize:15,color:colors.muted,lineHeight:22,marginTop:9,marginBottom:21},note:{fontSize:13,color:colors.muted,lineHeight:19,marginTop:21,textAlign:'center'}})
const admin=StyleSheet.create({typeRow:{flexDirection:'row',gap:9,marginBottom:10},typeChoice:{flex:1,minHeight:48,padding:13,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},typeSelected:{backgroundColor:'#38563C',borderColor:'#78997D'},typeText:{fontSize:14,fontWeight:'800',color:colors.ink},audit:{flexDirection:'row',alignItems:'flex-start',gap:14,padding:18,minHeight:70,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginBottom:12},auditCost:{fontSize:15,fontWeight:'800',color:colors.ink},resultLink:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:4,minHeight:38,marginTop:10,paddingHorizontal:11,paddingVertical:8,backgroundColor:'#263126',borderWidth:1,borderColor:'#3B4B3C',borderRadius:10},resultLinkText:{fontSize:12,fontWeight:'800',color:colors.sage},disabled:{opacity:.42},activeBadge:{minHeight:38,justifyContent:'center',paddingHorizontal:11,paddingVertical:8,backgroundColor:'#263126',borderWidth:1,borderColor:'#3B4B3C',borderRadius:20},activeText:{fontSize:11,fontWeight:'800',color:colors.sage},resetPanel:{padding:18,marginTop:-4,marginBottom:14,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,gap:12},budgetCard:{padding:21,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line},budgetProgress:{height:9,overflow:'hidden',marginBottom:10,backgroundColor:'#24292A',borderRadius:9},budgetFill:{height:9,backgroundColor:colors.sage,borderRadius:9}})
const resultUi=StyleSheet.create({activityCard:{padding:18,minHeight:70,borderRadius:18,backgroundColor:colors.glass,borderWidth:1,borderColor:colors.line,marginBottom:12},activityHeader:{flexDirection:'row',alignItems:'flex-start',gap:14},chevronOpen:{transform:[{rotate:'90deg'}]},viewer:{marginTop:17,paddingTop:17,borderTopWidth:1,borderTopColor:colors.line},viewerHead:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:14},viewerTitle:{fontSize:16,fontWeight:'800',color:colors.ink},viewerMeta:{fontSize:12,color:colors.muted,marginTop:3},outputText:{padding:15,fontSize:15,lineHeight:23,color:colors.ink,backgroundColor:colors.glassStrong,borderRadius:13},errorText:{padding:13,fontSize:13,lineHeight:19,color:'#F2A79A',backgroundColor:'#351D1C',borderRadius:12,marginBottom:12},image:{width:'100%',height:320,backgroundColor:'#101313',borderRadius:15},video:{width:'100%',height:260,backgroundColor:'#000',borderRadius:15},download:{minHeight:50,marginTop:15,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:13,backgroundColor:colors.sage,borderRadius:13},downloadText:{fontSize:14,fontWeight:'800',color:'#071009'}})
