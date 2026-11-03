import { useEffect, useRef, useState } from 'react'
import { useRelay } from '../store'
import { Avatar } from './Avatar'

export function Sidebar() {
  const relay = useRelay()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeServerId = relay.view.kind === 'server' ? relay.view.serverId : null
  const server = activeServerId ? relay.servers.find((item) => item.id === activeServerId) ?? null : null

  useEffect(() => {
    setMenuOpen(false)
  }, [relay.view.kind, server?.id])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [menuOpen])

  return (
    <aside className="sidebar">
      {server ? (
        <div className="sidebar-head" ref={menuRef}>
          <button className="sidebar-title" onClick={() => setMenuOpen((open) => !open)}>
            <span>{server.name}</span>
            <Caret open={menuOpen} />
          </button>
          {menuOpen && (
            <div className="side-menu">
              <button type="button" onClick={() => { setMenuOpen(false); relay.setModal({ type: 'invite', serverId: server.id }) }}>Invite people</button>
              <button type="button" onClick={() => { setMenuOpen(false); relay.setModal({ type: 'create-channel', serverId: server.id }) }}>Create channel</button>
              <button type="button" onClick={() => { setMenuOpen(false); relay.setModal({ type: 'leave-server', serverId: server.id }) }}>Leave server</button>
              {relay.me?.id === server.ownerId && (
                <button type="button" className="danger-text" onClick={() => { setMenuOpen(false); relay.setModal({ type: 'delete-server', serverId: server.id }) }}>Delete server</button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="sidebar-head quiet">
          <div className="sidebar-title static">
            <span>Direct Messages</span>
            <button className="icon-btn" title="New conversation" onClick={() => relay.setModal({ type: 'new-dm' })}>
              +
            </button>
          </div>
        </div>
      )}
      <div className="sidebar-scroll">
        {server ? (
          <>
            <div className="section-label">
              <span>Text channels</span>
              <button className="tiny" title="Create channel" onClick={() => relay.setModal({ type: 'create-channel', serverId: server.id })}>
                +
              </button>
            </div>
            {server.channels.map((channel) => {
              const active = relay.view.channelId === channel.id
              const hasUnread = relay.unread.includes(channel.id)
              return (
                <div key={channel.id} className={active ? 'channel-row active' : hasUnread ? 'channel-row unread' : 'channel-row'}>
                  <button className="channel" onClick={() => relay.openChannel(channel.id)}>
                    <span className="hash">#</span>
                    <span className="name">{channel.name}</span>
                  </button>
                  {relay.me?.id === server.ownerId && server.channels.length > 1 && (
                    <button
                      className="tiny channel-delete"
                      title={`Delete #${channel.name}`}
                      onClick={() => relay.setModal({ type: 'delete-channel', serverId: server.id, channelId: channel.id, name: channel.name })}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </>
        ) : relay.dms.length === 0 ? (
          <div className="sidebar-empty">
            <p>No conversations yet.</p>
            <button className="secondary" type="button" onClick={() => relay.setModal({ type: 'new-dm' })}>
              New message
            </button>
          </div>
        ) : (
          relay.dms.map((dm) => {
            const active = relay.view.kind === 'home' && relay.view.channelId === dm.id
            const hasUnread = relay.unread.includes(dm.id)
            return (
              <button key={dm.id} className={active ? 'dm-row active' : hasUnread ? 'dm-row unread' : 'dm-row'} onClick={() => relay.openDm(dm.id)}>
                <Avatar name={dm.peer.displayName} color={dm.peer.avatarColor} size={32} online={relay.online.includes(dm.peer.id)} />
                <span className="dm-copy">
                  <span className="name">{dm.peer.displayName}</span>
                  <span className="preview">{dm.lastMessage?.content ?? 'No messages yet'}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
      {relay.me && (
        <div className="me-bar">
          <Avatar name={relay.me.displayName} color={relay.me.avatarColor} size={32} online={relay.live === 'online'} />
          <div className="me-copy">
            <strong>{relay.me.displayName}</strong>
            <span>@{relay.me.username}</span>
          </div>
          <button className="icon-btn" title="Settings" onClick={() => relay.setModal({ type: 'settings' })}>
            <Gear />
          </button>
        </div>
      )}
    </aside>
  )
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg className={open ? 'caret open' : 'caret'} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function Gear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19.4 13.5a7.7 7.7 0 0 0 .1-1.5 7.7 7.7 0 0 0-.1-1.5l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.6 7.6 0 0 0 7 6l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4L7 18a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.6 7.6 0 0 0 17 18l2.4 1 2-3.4-2-1.6zM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4z" />
    </svg>
  )
}
