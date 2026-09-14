import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Notice } from '../components'

export default function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true); setError('')
    try {
      await onLogin(email.trim(), password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth">
    <section className="auth-card">
      <div className="brand"><img src="/brand/cresco-mark.png" alt="" /><span>Cresco Labs</span></div>
      <h1>Sign in</h1>
      <p>Your team's private model workspace.</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <div className="password-field">
            <input className="input" type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
            <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide password' : 'Show password'}>
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="auth-foot">
        <ShieldCheck size={15} />
        <span>Access is invite only. An administrator creates and approves every account.</span>
      </div>
    </section>
  </main>
}
