import { FormEvent, useState } from 'react'
import { getServerUrl } from '../api'
import { useRelay } from '../store'

export function AuthScreen() {
  const relay = useRelay()
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [serverUrl, setServerUrl] = useState(relay.serverUrl || getServerUrl())
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      if (mode === 'login') await relay.login(username.trim(), password, serverUrl)
      else await relay.register({ username: username.trim(), password, displayName: displayName.trim(), serverUrl })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand">
          <Logo />
          <span>Relay</span>
        </div>
        <h1>Your servers, in an app you can install.</h1>
        <p>Text channels, direct messages, and live presence. One person runs the server. Everyone else connects to that address.</p>
        <div className="preview-card" aria-hidden="true">
          <div className="preview-msg">
            <span className="dot" style={{ background: '#5865f2' }} />
            <div>
              <strong>Ava</strong>
              <span>shipped the Linux build</span>
            </div>
          </div>
          <div className="preview-msg">
            <span className="dot" style={{ background: '#3ba55d' }} />
            <div>
              <strong>Noah</strong>
              <span>Windows installer is up too</span>
            </div>
          </div>
          <div className="preview-msg">
            <span className="dot" style={{ background: '#eb459e' }} />
            <div>
              <strong>Mina</strong>
              <span>see you in #general</span>
            </div>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={onSubmit}>
          <h2>{mode === 'login' ? 'Welcome back' : 'Create an account'}</h2>
          <p className="muted">Use the same server address as the people you want to reach.</p>
          <label>
            Server
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://127.0.0.1:4000" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          {mode === 'register' && (
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How friends see you" maxLength={32} />
            </label>
          )}
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="letters, numbers, underscores" autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} required />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary" type="submit" disabled={pending}>
            {pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Register'}
          </button>
          <button
            className="linkish"
            type="button"
            onClick={() => {
              setMode((current) => (current === 'login' ? 'register' : 'login'))
              setError('')
            }}
          >
            {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Log in'}
          </button>
        </form>
      </section>
    </div>
  )
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#5865f2" />
      <rect x="14" y="18" width="36" height="24" rx="12" fill="white" />
      <circle cx="26" cy="30" r="3.2" fill="#5865f2" />
      <circle cx="32" cy="30" r="3.2" fill="#5865f2" />
      <circle cx="38" cy="30" r="3.2" fill="#5865f2" />
    </svg>
  )
}
