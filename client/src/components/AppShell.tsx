import { ServerRail } from './ServerRail'
import { Sidebar } from './Sidebar'
import { ChatView } from './ChatView'
import { MemberList } from './MemberList'
import { Modals } from './Modals'
import { useRelay } from '../store'

export function AppShell() {
  const relay = useRelay()
  const showMembers = relay.view.kind === 'server'
  return (
    <div className={showMembers ? 'app' : 'app no-members'}>
      <ServerRail />
      <Sidebar />
      <ChatView />
      {showMembers && <MemberList />}
      {relay.live === 'offline' && <div className="banner">Reconnecting to the server…</div>}
      <Modals />
      <div className="toasts">
        {relay.toasts.map((item) => (
          <button key={item.id} type="button" className={`toast ${item.tone}`} onClick={() => relay.dismissToast(item.id)}>
            {item.text}
          </button>
        ))}
      </div>
    </div>
  )
}
