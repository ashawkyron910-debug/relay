export type User = {
  id: string
  username: string
  displayName: string
  avatarColor: string
  createdAt: number
}

export type Channel = {
  id: string
  serverId: string | null
  name: string
  kind: 'text' | 'dm'
  position: number
  createdAt: number
}

export type ServerInfo = {
  id: string
  name: string
  ownerId: string
  inviteCode: string
  iconColor: string
  createdAt: number
  channels: Channel[]
  members: User[]
}

export type DirectMessage = {
  id: string
  peer: User
  lastMessage: { id: string; content: string; createdAt: number } | null
}

export type Message = {
  id: string
  channelId: string
  content: string
  createdAt: number
  editedAt: number | null
  author: User
}

export type View =
  | { kind: 'home'; channelId: string | null }
  | { kind: 'server'; serverId: string; channelId: string | null }

export type ModalState =
  | null
  | { type: 'create-server' }
  | { type: 'join-server' }
  | { type: 'invite'; serverId: string }
  | { type: 'create-channel'; serverId: string }
  | { type: 'new-dm' }
  | { type: 'settings' }
  | { type: 'delete-server'; serverId: string }
  | { type: 'leave-server'; serverId: string }
  | { type: 'delete-channel'; serverId: string; channelId: string; name: string }

export type Toast = { id: string; text: string; tone: 'ok' | 'error' }

export type TypingUser = { userId: string; displayName: string; until: number }

export type Bootstrap = {
  user: User
  servers: ServerInfo[]
  dms: DirectMessage[]
}
