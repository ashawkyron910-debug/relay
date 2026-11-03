import { useEffect, useRef, useState } from 'react'
import { useRelay } from '../store'
import { initial } from './Avatar'
import { Logo } from './AuthScreen'

export function ServerRail() {
  const { servers, view, unread, openHome, openServer, setModal, dms } = useRelay()
  const [addOpen, setAddOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const addRef = useRef<HTMLDivElement>(null)
  const homeUnread = dms.some((dm) => unread.includes(dm.id))

  useEffect(() => {
    if (!addOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!addRef.current?.contains(event.target as Node)) setAddOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [addOpen])

  return (
    <nav className="rail" aria-label="Servers">
      <div className={view.kind === 'home' ? 'server-slot active' : homeUnread ? 'server-slot unread' : 'server-slot'}>
        <button className={view.kind === 'home' ? 'server-btn home active' : 'server-btn home'} title="Direct messages" onClick={openHome}>
          <Logo />
        </button>
      </div>
      <div className="rail-divider" />
      {servers.map((server) => {
        const active = view.kind === 'server' && view.serverId === server.id
        const hasUnread = server.channels.some((channel) => unread.includes(channel.id))
        return (
          <div key={server.id} className={active ? 'server-slot active' : hasUnread ? 'server-slot unread' : 'server-slot'}>
            <button className={active ? 'server-btn active' : 'server-btn'} style={{ background: server.iconColor }} title={server.name} onClick={() => openServer(server.id)}>
              {initial(server.name)}
            </button>
          </div>
        )
      })}
      <div className="server-slot add" ref={addRef}>
        <button
          className="server-btn add"
          title="Add a server"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuPos({ top: rect.top, left: rect.right + 12 })
            setAddOpen((open) => !open)
          }}
        >
          +
        </button>
        {addOpen && (
          <div className="rail-menu" style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 40 }}>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false)
                setModal({ type: 'create-server' })
              }}
            >
              Create a server
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false)
                setModal({ type: 'join-server' })
              }}
            >
              Join with a code
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
