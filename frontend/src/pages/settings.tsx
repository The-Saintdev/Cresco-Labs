import { useState } from 'react'
import { updateMe } from '../api'
import { Notice, Segmented, Switch } from '../components'
import { useWorkspace, applyTheme, storedTheme, type Theme } from '../lib/store'

export default function SettingsPage() {
  const { user, setUser, toast, signOut } = useWorkspace()
  const [name, setName] = useState(user.name)
  const [completed, setCompleted] = useState(user.preferences?.generationCompleted ?? true)
  const [weekly, setWeekly] = useState(user.preferences?.weeklySummary ?? true)
  const [failed, setFailed] = useState(user.preferences?.generationFailed ?? true)
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const saveProfile = async () => {
    setBusy(true); setError('')
    try {
      const data = await updateMe({ name: name.trim(), preferences: { generationCompleted: completed, weeklySummary: weekly, generationFailed: failed } })
      setUser(data.user)
      toast('Settings saved')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save your settings.')
    } finally { setBusy(false) }
  }

  const savePassword = async () => {
    if (next !== confirm) return setError('The new passwords do not match.')
    setBusy(true); setError('')
    try {
      const data = await updateMe({ currentPassword: current, newPassword: next })
      setUser(data.user)
      setCurrent(''); setNext(''); setConfirm('')
      toast('Password updated')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update your password.')
    } finally { setBusy(false) }
  }

  const changeTheme = (value: Theme) => { setTheme(value); applyTheme(value) }

  return <div className="page" style={{ maxWidth: 680 }}>
    <div className="page-head"><div><h1>Settings</h1><p>Your profile, appearance and session.</p></div></div>

    {error && <div style={{ marginBottom: 12 }}><Notice tone="error">{error}</Notice></div>}

    <div className="panel">
      <div className="panel-head"><h2>Profile</h2><p>Visible to your teammates.</p></div>
      <div className="panel-body">
        <div className="form-grid">
          <label className="field"><span>Full name</span><input className="input" value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="field">
            <span>Email</span>
            <input className="input" value={user.email} readOnly />
            <small className="field-hint">An administrator manages email changes.</small>
          </label>
        </div>
      </div>
    </div>

    <div className="panel">
      <div className="panel-head"><h2>Appearance</h2><p>Applies to this browser only.</p></div>
      <div className="panel-body">
        <Segmented
          value={theme}
          onChange={changeTheme}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const}
        />
      </div>
    </div>

    <div className="panel">
      <div className="panel-head"><h2>Notifications</h2></div>
      <div className="panel-body">
        <Switch label="Generation completed" detail="When an image or video is ready" checked={completed} onChange={setCompleted} />
        <Switch label="Failed generations" detail="When a request needs attention" checked={failed} onChange={setFailed} />
        <Switch label="Weekly usage summary" detail="A Monday overview of team spend" checked={weekly} onChange={setWeekly} />
      </div>
      <div className="panel-foot">
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={busy || name.trim().length < 2} onClick={() => void saveProfile()}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>

    <div className="panel">
      <div className="panel-head"><h2>Password</h2><p>Changing it signs out every other session.</p></div>
      <div className="panel-body">
        <div className="form-grid">
          <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} /></label>
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} /></label>
          <label className="field"><span>Confirm new password</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        </div>
      </div>
      <div className="panel-foot">
        <small>At least 10 characters.</small>
        <span className="spacer" />
        <button className="btn btn-secondary btn-sm" disabled={busy || !current || next.length < 10 || !confirm} onClick={() => void savePassword()}>Update password</button>
      </div>
    </div>

    <div className="panel">
      <div className="panel-head"><h2>Session</h2><p>You are signed in on this browser.</p></div>
      <div className="panel-foot">
        <span className="spacer" />
        <button className="btn btn-danger btn-sm" onClick={signOut}>Sign out</button>
      </div>
    </div>
  </div>
}
