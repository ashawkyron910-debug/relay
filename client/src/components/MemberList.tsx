import { useRelay } from '../store'
import { Avatar } from './Avatar'

export function MemberList() {
  const { view, servers, online } = useRelay()
  if (view.kind !== 'server') return null
  const server = servers.find((item) => item.id === view.serverId)
  if (!server) return null
  const onlineMembers = server.members.filter((member) => online.includes(member.id))
  const offlineMembers = server.members.filter((member) => !online.includes(member.id))

  return (
    <aside className="members" aria-label="Members">
      <Group title={`Online — ${onlineMembers.length}`} members={onlineMembers} ownerId={server.ownerId} online />
      <Group title={`Offline — ${offlineMembers.length}`} members={offlineMembers} ownerId={server.ownerId} online={false} />
    </aside>
  )
}

function Group({
  title,
  members,
  ownerId,
  online,
}: {
  title: string
  members: { id: string; displayName: string; username: string; avatarColor: string }[]
  ownerId: string
  online: boolean
}) {
  if (members.length === 0) return null
  const sorted = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))
  return (
    <section>
      <h3>{title}</h3>
      {sorted.map((member) => (
        <div key={member.id} className="member" title={`@${member.username}`}>
          <Avatar name={member.displayName} color={member.avatarColor} size={32} online={online} />
          <div>
            <div className="member-name">{member.displayName}</div>
            {member.id === ownerId && <div className="member-role">Owner</div>}
          </div>
        </div>
      ))}
    </section>
  )
}
