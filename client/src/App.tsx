import { Component, type ReactNode } from 'react'
import { RelayProvider, useRelay } from './store'
import { AuthScreen } from './components/AuthScreen'
import { AppShell } from './components/AppShell'

export function App() {
  return (
    <Boundary>
      <RelayProvider>
        <Gate />
      </RelayProvider>
    </Boundary>
  )
}

function Gate() {
  const relay = useRelay()
  if (!relay.token || relay.status === 'signed-out') return <AuthScreen />
  if (relay.status === 'error' || (relay.status === 'ready' && !relay.me)) {
    return <BootScreen label={relay.bootError || 'Could not open Relay.'} onRetry={relay.retry} />
  }
  if (relay.status !== 'ready') return <BootScreen label="Opening Relay…" />
  return <AppShell />
}

function BootScreen({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div className="boot">
      <div className="boot-card">
        <h1>Relay</h1>
        <p>{label}</p>
        {onRetry && (
          <button className="primary" type="button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="boot">
          <div className="boot-card">
            <h1>Relay</h1>
            <p>The app hit a problem. Reload the window to continue.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
