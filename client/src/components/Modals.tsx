import { FormEvent, useEffect, useState } from 'react'
import { useRelay } from '../store'

export function Modals() {
  const { modal, setModal } = useRelay()

  useEffect(() => {
    if (!modal) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, setModal])

  if (!modal) return null

  return (
    <div className="backdrop" onMouseDown={() => setModal(null)}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        {modal.type === 'create-server' && <CreateServer />}
        {modal.type === 'join-server' && <JoinServer />}
        {modal.type === 'invite' && <Invite serverId={modal.serverId} />}
        {modal.type === 'create-channel' && <CreateChannel serverId={modal.serverId} />}
        {modal.type === 'new-dm' && <NewDm />}
        {modal.type === 'settings' && <Settings />}
        {modal.type === 'leave-server' && <LeaveServer serverId={modal.serverId} />}
        {modal.type === 'delete-server' && <DeleteServer serverId={modal.serverId} />}
        {modal.type === 'delete-channel' && <DeleteChannel channelId={modal.channelId} name={modal.name} />}
      </div>
    </div>
  )
}

function CreateServer() {
  const relay = useRelay()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await relay.createServer(name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h3>Create a server</h3>
      <p>This is your space. You can invite people with a code after it’s created.</p>
      <label>
        Server name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus required />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create'}</button>
      </div>
    </form>
  )
}

function JoinServer() {
  const relay = useRelay()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await relay.joinServer(code)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join that server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h3>Join a server</h3>
      <p>Paste the invite code someone shared with you.</p>
      <label>
        Invite code
        <input value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus required />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="primary" disabled={pending || !code.trim()}>{pending ? 'Joining…' : 'Join'}</button>
      </div>
    </form>
  )
}

function Invite({ serverId }: { serverId: string }) {
  const relay = useRelay()
  const server = relay.servers.find((item) => item.id === serverId)

  async function copy() {
    if (!server) return
    try {
      await navigator.clipboard.writeText(server.inviteCode)
      relay.toast('Invite code copied.', 'ok')
    } catch {
      relay.toast('Select the code and copy it.')
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        relay.setModal(null)
      }}
    >
      <h3>Invite people</h3>
      <p>{server ? `Share this code for ${server.name}. They enter it on the same server address.` : 'That server is no longer available.'}</p>
      {server && (
        <label>
          Invite code
          <input readOnly value={server.inviteCode} onFocus={(event) => event.target.select()} />
        </label>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Close</button>
        {server && (
          <button type="button" className="primary" onClick={() => void copy()}>
            Copy code
          </button>
        )}
      </div>
    </form>
  )
}

function CreateChannel({ serverId }: { serverId: string }) {
  const relay = useRelay()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await relay.createChannel(serverId, name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the channel.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h3>Create a channel</h3>
      <p>Names become lowercase words, like planning-room.</p>
      <label>
        Channel name
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="primary" disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create'}</button>
      </div>
    </form>
  )
}

function NewDm() {
  const relay = useRelay()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await relay.startDm(username)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that conversation.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h3>New message</h3>
      <p>Start a direct conversation with someone who already has an account on this server.</p>
      <label>
        Username
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus required />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="primary" disabled={pending || !username.trim()}>{pending ? 'Opening…' : 'Message'}</button>
      </div>
    </form>
  )
}

function Settings() {
  const relay = useRelay()
  const [displayName, setDisplayName] = useState(relay.me?.displayName ?? '')
  const [serverUrl, setServerUrl] = useState(relay.serverUrl)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      await relay.updateProfile(displayName)
      relay.toast('Display name saved.', 'ok')
      relay.setModal(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setPending(false)
    }
  }

  async function saveServer() {
    setPending(true)
    setError('')
    try {
      const result = await relay.changeServer(serverUrl)
      if (result === 'same') {
        relay.toast('That server is already connected.', 'ok')
        relay.setModal(null)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the server.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={saveProfile}>
      <h3>Settings</h3>
      <p className="muted">{window.relayDesktop ? `Desktop app · ${window.relayDesktop.platform}` : 'Browser'} · Relay 0.1.0</p>
      <label>
        Display name
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} autoFocus />
      </label>
      <label>
        Server address
        <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} spellCheck={false} autoCapitalize="off" />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions wrap">
        <button type="button" className="secondary" onClick={() => relay.logout()}>Log out</button>
        <button type="button" className="secondary" disabled={pending} onClick={() => void saveServer()}>Use this server</button>
        <button className="primary" disabled={pending || !displayName.trim()}>Save name</button>
      </div>
    </form>
  )
}

function LeaveServer({ serverId }: { serverId: string }) {
  const relay = useRelay()
  const server = relay.servers.find((item) => item.id === serverId)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setError('')
        try {
          await relay.leaveServer(serverId)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not leave the server.')
          setPending(false)
        }
      }}
    >
      <h3>Leave {server?.name ?? 'server'}?</h3>
      <p>You can rejoin later with the invite code. If you own the server and other people are still in it, ownership passes to the longest-standing member.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="danger" disabled={pending}>{pending ? 'Leaving…' : 'Leave'}</button>
      </div>
    </form>
  )
}

function DeleteServer({ serverId }: { serverId: string }) {
  const relay = useRelay()
  const server = relay.servers.find((item) => item.id === serverId)
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const matches = server ? confirm.trim() === server.name : false

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (!matches) return
        setPending(true)
        setError('')
        try {
          await relay.deleteServer(serverId)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not delete the server.')
          setPending(false)
        }
      }}
    >
      <h3>Delete {server?.name ?? 'server'}?</h3>
      <p>This removes the server, its channels, and its messages for everyone.</p>
      <label>
        Type {server?.name} to confirm
        <input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoFocus />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="danger" disabled={!matches || pending}>{pending ? 'Deleting…' : 'Delete server'}</button>
      </div>
    </form>
  )
}

function DeleteChannel({ channelId, name }: { channelId: string; name: string }) {
  const relay = useRelay()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setPending(true)
        setError('')
        try {
          await relay.deleteChannel(channelId)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not delete the channel.')
          setPending(false)
        }
      }}
    >
      <h3>Delete #{name}?</h3>
      <p>Messages in this channel are removed for everyone.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => relay.setModal(null)}>Cancel</button>
        <button className="danger" disabled={pending}>{pending ? 'Deleting…' : 'Delete channel'}</button>
      </div>
    </form>
  )
}
