import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, checkHealth, clearToken, getServerUrl, getToken, normalizeServerUrl, saveServerUrl, saveToken } from './api'
import { connectSocket, disconnectSocket, getSocket } from './socket'
import type { Bootstrap, Channel, DirectMessage, Message, ModalState, ServerInfo, Toast, TypingUser, User, View } from './types'

type Live = 'connecting' | 'online' | 'offline'
type Status = 'signed-out' | 'loading' | 'ready' | 'error'
type UserPatch = { id: string; username: string; displayName: string; avatarColor: string }

type AppData = {
  me: User | null
  servers: ServerInfo[]
  dms: DirectMessage[]
  view: View
  messages: Record<string, Message[]>
  hasMore: Record<string, boolean>
  online: string[]
  typing: Record<string, TypingUser[]>
  unread: string[]
  modal: ModalState
}

type RelayContextValue = AppData & {
  token: string | null
  serverUrl: string
  status: Status
  bootError: string
  live: Live
  toasts: Toast[]
  retry: () => void
  login: (username: string, password: string, serverUrl: string) => Promise<void>
  register: (input: { username: string; password: string; displayName: string; serverUrl: string }) => Promise<void>
  logout: () => void
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  setModal: (modal: ModalState) => void
  openHome: () => void
  openServer: (serverId: string) => void
  openChannel: (channelId: string) => void
  openDm: (channelId: string) => void
  loadMessages: (channelId: string) => Promise<void>
  loadOlder: (channelId: string) => Promise<void>
  sendMessage: (channelId: string, content: string) => Promise<void>
  editMessage: (messageId: string, content: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  notifyTyping: (channelId: string) => void
  createServer: (name: string) => Promise<void>
  joinServer: (code: string) => Promise<void>
  leaveServer: (serverId: string) => Promise<void>
  deleteServer: (serverId: string) => Promise<void>
  createChannel: (serverId: string, name: string) => Promise<void>
  deleteChannel: (channelId: string) => Promise<void>
  startDm: (username: string) => Promise<void>
  updateProfile: (displayName: string) => Promise<void>
  changeServer: (url: string) => Promise<'same' | 'switched'>
}

const RelayContext = createContext<RelayContextValue | null>(null)

function freshApp(): AppData {
  return {
    me: null,
    servers: [],
    dms: [],
    view: { kind: 'home', channelId: null },
    messages: {},
    hasMore: {},
    online: [],
    typing: {},
    unread: [],
    modal: null,
  }
}

function byTime(a: Message, b: Message) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function upsertMessage(list: Message[] | undefined, message: Message) {
  const next = (list ?? []).filter((item) => item.id !== message.id)
  next.push(message)
  next.sort(byTime)
  return next
}

function patchUser<T extends { id: string; username: string; displayName: string; avatarColor: string }>(user: T, patch: UserPatch): T {
  if (user.id !== patch.id) return user
  return { ...user, username: patch.username, displayName: patch.displayName, avatarColor: patch.avatarColor }
}

function rememberDm(view: View, channelId: string | null) {
  if (view.kind === 'home' && view.channelId) return view.channelId
  return channelId
}

export function RelayProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken())
  const [serverUrl, setServerUrl] = useState(() => getServerUrl())
  const [status, setStatus] = useState<Status>(() => (getToken() ? 'loading' : 'signed-out'))
  const [bootError, setBootError] = useState('')
  const [live, setLive] = useState<Live>('offline')
  const [attempt, setAttempt] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [app, setApp] = useState<AppData>(freshApp)
  const appRef = useRef(app)
  const meRef = useRef<User | null>(null)
  const lastDm = useRef<string | null>(null)
  const typingSent = useRef<Record<string, number>>({})
  const loadSeq = useRef<Record<string, number>>({})
  const loadMessagesRef = useRef<(channelId: string) => Promise<void>>(async () => undefined)
  const generation = useRef(0)
  const goneServers = useRef(new Set<string>())
  const goneChannels = useRef(new Set<string>())
  appRef.current = app

  const bump = () => {
    generation.current += 1
  }

  const toast = useCallback((text: string, tone: Toast['tone'] = 'error') => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current.slice(-4), { id, text, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const logout = useCallback(() => {
    clearToken()
    disconnectSocket()
    meRef.current = null
    setToken(null)
    setStatus('signed-out')
    setLive('offline')
    setApp(freshApp())
  }, [])

  useEffect(() => {
    const onUnauthorized = () => logout()
    window.addEventListener('relay:unauthorized', onUnauthorized)
    return () => window.removeEventListener('relay:unauthorized', onUnauthorized)
  }, [logout])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setApp((current) => {
        const now = Date.now()
        let changed = false
        const typing = { ...current.typing }
        for (const [channelId, people] of Object.entries(typing)) {
          const next = people.filter((person) => person.until > now)
          if (next.length !== people.length) {
            changed = true
            typing[channelId] = next
          }
        }
        return changed ? { ...current, typing } : current
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const applyDirectory = useCallback((data: Bootstrap) => {
    setApp((current) => {
      const servers = data.servers
        .filter((server) => !goneServers.current.has(server.id))
        .map((server) => {
          const previous = current.servers.find((item) => item.id === server.id)
          const channels = mergeChannels(server.channels, previous?.channels ?? []).filter((channel) => !goneChannels.current.has(channel.id))
          const members = mergeUsers(server.members, previous?.members ?? [])
          return { ...server, channels, members }
        })
      for (const server of current.servers) {
        if (!goneServers.current.has(server.id) && !servers.some((item) => item.id === server.id)) servers.push(server)
      }
      return {
        ...current,
        me: data.user,
        servers: servers.sort((a, b) => a.createdAt - b.createdAt),
        dms: mergeDms(data.dms, current.dms),
      }
    })
  }, [])

  useEffect(() => {
    if (!token) {
      setStatus('signed-out')
      setLive('offline')
      disconnectSocket()
      return
    }

    let cancel = false
    goneServers.current = new Set()
    goneChannels.current = new Set()
    generation.current = 0
    setStatus('loading')
    setLive('connecting')
    setBootError('')
    setApp(freshApp())
    meRef.current = null

    const socket = connectSocket(serverUrl, token)
    socket.on('connect', () => {
      if (!cancel) setLive('online')
      const channelId = appRef.current.view.channelId
      if (channelId) void loadMessagesRef.current(channelId).catch(() => undefined)
    })
    socket.on('disconnect', () => {
      if (!cancel) setLive('offline')
    })
    socket.on('connect_error', () => {
      if (!cancel) setLive('offline')
    })
    socket.on('presence:snapshot', (payload: { userIds: string[] }) => {
      setApp((current) => ({ ...current, online: payload.userIds }))
    })
    socket.on('presence', (payload: { userId: string; status: 'online' | 'offline' }) => {
      setApp((current) => {
        const online = new Set(current.online)
        if (payload.status === 'online') online.add(payload.userId)
        else online.delete(payload.userId)
        return { ...current, online: [...online] }
      })
    })
    socket.on('typing', (payload: { channelId: string; userId: string; displayName: string }) => {
      if (payload.userId === meRef.current?.id) return
      setApp((current) => {
        const people = (current.typing[payload.channelId] ?? []).filter((person) => person.userId !== payload.userId)
        people.push({ userId: payload.userId, displayName: payload.displayName, until: Date.now() + 3500 })
        return { ...current, typing: { ...current.typing, [payload.channelId]: people } }
      })
    })
    socket.on('message:created', (message: Message) => {
      bump()
      setApp((current) => addIncomingMessage(current, message))
    })
    socket.on('message:updated', (message: Message) => {
      setApp((current) => ({
        ...current,
        messages: { ...current.messages, [message.channelId]: upsertMessage(current.messages[message.channelId], message) },
        dms: touchDm(current.dms, message, false),
      }))
    })
    socket.on('message:deleted', (payload: { id: string; channelId: string }) => {
      bump()
      setApp((current) => removeMessage(current, payload.id, payload.channelId))
    })
    socket.on('channel:created', (channel: Channel) => {
      bump()
      setApp((current) => addChannel(current, channel))
    })
    socket.on('channel:deleted', (payload: { id: string; serverId: string }) => {
      bump()
      goneChannels.current.add(payload.id)
      setApp((current) => removeChannel(current, payload.serverId, payload.id))
    })
    socket.on('server:deleted', (payload: { id: string }) => {
      bump()
      goneServers.current.add(payload.id)
      setApp((current) => dropServer(current, payload.id))
    })
    socket.on('server:updated', (payload: { id: string; ownerId: string }) => {
      bump()
      setApp((current) => ({
        ...current,
        servers: current.servers.map((server) => (server.id === payload.id ? { ...server, ownerId: payload.ownerId } : server)),
      }))
    })
    socket.on('member:joined', (payload: { serverId: string; user: User }) => {
      bump()
      setApp((current) => addMember(current, payload.serverId, payload.user))
    })
    socket.on('member:left', (payload: { serverId: string; userId: string }) => {
      bump()
      setApp((current) => {
        if (payload.userId === current.me?.id) {
          goneServers.current.add(payload.serverId)
          return dropServer(current, payload.serverId)
        }
        return removeMember(current, payload.serverId, payload.userId)
      })
    })
    socket.on('dm:created', (dm: DirectMessage) => {
      bump()
      setApp((current) => addDm(current, dm))
    })
    socket.on('user:updated', (patch: UserPatch) => {
      bump()
      if (patch.id === meRef.current?.id) meRef.current = meRef.current ? { ...meRef.current, ...patch } : meRef.current
      setApp((current) => applyUserPatch(current, patch))
    })

    async function boot() {
      try {
        let stamp = generation.current
        let data = await api<Bootstrap>('/api/bootstrap')
        if (cancel) return
        if (generation.current !== stamp) {
          stamp = generation.current
          data = await api<Bootstrap>('/api/bootstrap')
          if (cancel) return
        }
        meRef.current = data.user
        applyDirectory(data)
        setStatus('ready')
      } catch (error) {
        if (cancel) return
        if (error instanceof ApiError && error.status === 401) {
          logout()
          return
        }
        setBootError(error instanceof Error ? error.message : 'Could not load Relay.')
        setStatus('error')
      }
    }

    void boot()
    return () => {
      cancel = true
      disconnectSocket()
    }
  }, [token, serverUrl, attempt, applyDirectory, logout])

  async function authenticate(path: '/api/auth/login' | '/api/auth/register', body: object, nextUrl: string) {
    const normalized = normalizeServerUrl(nextUrl)
    await checkHealth(normalized)
    const saved = saveServerUrl(normalized)
    const result = await api<{ token: string }>(path, { body, token: null, serverUrl: saved })
    saveToken(result.token)
    setServerUrl(saved)
    setToken(result.token)
    setStatus('loading')
  }

  const login = useCallback(async (username: string, password: string, nextUrl: string) => {
    await authenticate('/api/auth/login', { username, password }, nextUrl)
  }, [])

  const register = useCallback(async (input: { username: string; password: string; displayName: string; serverUrl: string }) => {
    await authenticate('/api/auth/register', { username: input.username, password: input.password, displayName: input.displayName }, input.serverUrl)
  }, [])

  const loadMessages = useCallback(async (channelId: string) => {
    const seq = (loadSeq.current[channelId] ?? 0) + 1
    loadSeq.current[channelId] = seq
    const data = await api<{ messages: Message[]; hasMore: boolean }>(`/api/channels/${channelId}/messages?limit=50`)
    if (loadSeq.current[channelId] !== seq) return
    setApp((current) => {
      const existing = current.messages[channelId] ?? []
      const ids = new Set(data.messages.map((message) => message.id))
      const newest = data.messages[data.messages.length - 1]?.createdAt ?? 0
      const extras = existing.filter((message) => !ids.has(message.id) && message.createdAt >= newest)
      return {
        ...current,
        messages: { ...current.messages, [channelId]: [...data.messages, ...extras].sort(byTime) },
        hasMore: { ...current.hasMore, [channelId]: data.hasMore },
      }
    })
  }, [])
  loadMessagesRef.current = loadMessages

  const loadOlder = useCallback(async (channelId: string) => {
    const oldest = appRef.current.messages[channelId]?.[0]
    if (!oldest) return
    const data = await api<{ messages: Message[]; hasMore: boolean }>(
      `/api/channels/${channelId}/messages?limit=50&before=${oldest.createdAt}&beforeId=${encodeURIComponent(oldest.id)}`,
    )
    setApp((current) => {
      const existing = current.messages[channelId] ?? []
      const ids = new Set(existing.map((message) => message.id))
      const older = data.messages.filter((message) => !ids.has(message.id))
      return {
        ...current,
        messages: { ...current.messages, [channelId]: [...older, ...existing].sort(byTime) },
        hasMore: { ...current.hasMore, [channelId]: data.hasMore },
      }
    })
  }, [])

  const sendMessage = useCallback(async (channelId: string, content: string) => {
    const data = await api<{ message: Message }>(`/api/channels/${channelId}/messages`, { body: { content } })
    setApp((current) => addIncomingMessage(current, data.message, true))
  }, [])

  const editMessage = useCallback(async (messageId: string, content: string) => {
    const data = await api<{ message: Message }>(`/api/messages/${messageId}`, { method: 'PATCH', body: { content } })
    setApp((current) => ({
      ...current,
      messages: { ...current.messages, [data.message.channelId]: upsertMessage(current.messages[data.message.channelId], data.message) },
    }))
  }, [])

  const deleteMessage = useCallback(async (messageId: string) => {
    const data = await api<{ id: string; channelId: string }>(`/api/messages/${messageId}`, { method: 'DELETE', body: {} })
    setApp((current) => removeMessage(current, data.id, data.channelId))
  }, [])

  const notifyTyping = useCallback((channelId: string) => {
    const now = Date.now()
    if (now - (typingSent.current[channelId] ?? 0) < 2000) return
    typingSent.current[channelId] = now
    getSocket()?.emit('typing', { channelId })
  }, [])

  const createServer = useCallback(async (name: string) => {
    const data = await api<{ server: ServerInfo }>('/api/servers', { body: { name } })
    setApp((current) => ({
      ...current,
      servers: [...current.servers.filter((server) => server.id !== data.server.id), data.server],
      view: { kind: 'server', serverId: data.server.id, channelId: data.server.channels[0]?.id ?? null },
      modal: { type: 'invite', serverId: data.server.id },
      unread: current.unread.filter((id) => id !== data.server.channels[0]?.id),
    }))
  }, [])

  const joinServer = useCallback(async (code: string) => {
    const data = await api<{ server: ServerInfo }>(`/api/invites/${encodeURIComponent(code.trim())}/join`, { body: {} })
    goneServers.current.delete(data.server.id)
    setApp((current) => ({
      ...current,
      servers: [...current.servers.filter((server) => server.id !== data.server.id), data.server].sort((a, b) => a.createdAt - b.createdAt),
      view: { kind: 'server', serverId: data.server.id, channelId: data.server.channels[0]?.id ?? null },
      modal: null,
    }))
  }, [])

  const leaveServer = useCallback(async (serverId: string) => {
    await api(`/api/servers/${serverId}/leave`, { method: 'POST', body: {} })
    goneServers.current.add(serverId)
    setApp((current) => ({ ...dropServer(current, serverId), modal: null }))
  }, [])

  const deleteServerAction = useCallback(async (serverId: string) => {
    await api(`/api/servers/${serverId}`, { method: 'DELETE' })
    goneServers.current.add(serverId)
    setApp((current) => ({ ...dropServer(current, serverId), modal: null }))
  }, [])

  const createChannel = useCallback(async (serverId: string, name: string) => {
    const data = await api<{ channel: Channel }>(`/api/servers/${serverId}/channels`, { body: { name } })
    setApp((current) => {
      const withChannel = addChannel(current, data.channel)
      return {
        ...withChannel,
        view: { kind: 'server', serverId, channelId: data.channel.id },
        modal: null,
        unread: withChannel.unread.filter((id) => id !== data.channel.id),
      }
    })
  }, [])

  const deleteChannel = useCallback(async (channelId: string) => {
    await api(`/api/channels/${channelId}`, { method: 'DELETE' })
    const server = appRef.current.servers.find((item) => item.channels.some((channel) => channel.id === channelId))
    goneChannels.current.add(channelId)
    setApp((current) => ({ ...removeChannel(current, server?.id ?? '', channelId), modal: null }))
  }, [])

  const startDm = useCallback(async (username: string) => {
    const data = await api<{ dm: DirectMessage }>('/api/dms', { body: { username } })
    lastDm.current = data.dm.id
    setApp((current) => ({ ...addDm(current, data.dm), view: { kind: 'home', channelId: data.dm.id }, modal: null }))
  }, [])

  const updateProfile = useCallback(async (displayName: string) => {
    const data = await api<{ user: User }>('/api/me', { method: 'PATCH', body: { displayName } })
    meRef.current = data.user
    setApp((current) => applyUserPatch({ ...current, me: data.user }, data.user))
  }, [])

  const changeServer = useCallback(async (url: string) => {
    const normalized = normalizeServerUrl(url)
    await checkHealth(normalized)
    if (normalized === getServerUrl() && token) return 'same' as const
    saveServerUrl(normalized)
    clearToken()
    disconnectSocket()
    meRef.current = null
    setServerUrl(normalized)
    setToken(null)
    setStatus('signed-out')
    setApp(freshApp())
    return 'switched' as const
  }, [token])

  const setModal = useCallback((modal: ModalState) => setApp((current) => ({ ...current, modal })), [])

  const openHome = useCallback(() => {
    setApp((current) => {
      const channelId = current.dms.some((dm) => dm.id === lastDm.current) ? lastDm.current : null
      return { ...current, view: { kind: 'home', channelId }, unread: current.unread.filter((id) => id !== channelId) }
    })
  }, [])

  const openServer = useCallback((serverId: string) => {
    setApp((current) => {
      if (current.view.kind === 'home') lastDm.current = rememberDm(current.view, lastDm.current)
      const server = current.servers.find((item) => item.id === serverId)
      if (!server) return current
      const selected = current.view.kind === 'server' && current.view.serverId === serverId ? current.view.channelId : null
      const channelId = server.channels.some((channel) => channel.id === selected) ? selected : server.channels[0]?.id ?? null
      return { ...current, view: { kind: 'server', serverId, channelId }, unread: current.unread.filter((id) => id !== channelId) }
    })
  }, [])

  const openChannel = useCallback((channelId: string) => {
    setApp((current) => {
      if (current.view.kind !== 'server') return current
      return { ...current, view: { ...current.view, channelId }, unread: current.unread.filter((id) => id !== channelId) }
    })
  }, [])

  const openDm = useCallback((channelId: string) => {
    lastDm.current = channelId
    setApp((current) => ({ ...current, view: { kind: 'home', channelId }, unread: current.unread.filter((id) => id !== channelId) }))
  }, [])

  const value = useMemo<RelayContextValue>(
    () => ({
      ...app,
      token,
      serverUrl,
      status,
      bootError,
      live,
      toasts,
      retry: () => setAttempt((current) => current + 1),
      login,
      register,
      logout,
      toast,
      dismissToast,
      setModal,
      openHome,
      openServer,
      openChannel,
      openDm,
      loadMessages,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      notifyTyping,
      createServer,
      joinServer,
      leaveServer,
      deleteServer: deleteServerAction,
      createChannel,
      deleteChannel,
      startDm,
      updateProfile,
      changeServer,
    }),
    [
      app,
      token,
      serverUrl,
      status,
      bootError,
      live,
      toasts,
      login,
      register,
      logout,
      toast,
      dismissToast,
      setModal,
      openHome,
      openServer,
      openChannel,
      openDm,
      loadMessages,
      loadOlder,
      sendMessage,
      editMessage,
      deleteMessage,
      notifyTyping,
      createServer,
      joinServer,
      leaveServer,
      deleteServerAction,
      createChannel,
      deleteChannel,
      startDm,
      updateProfile,
      changeServer,
    ],
  )

  return <RelayContext.Provider value={value}>{children}</RelayContext.Provider>
}

function addIncomingMessage(current: AppData, message: Message, own = false) {
  const viewing = current.view.channelId === message.channelId
  const fromMe = own || message.author.id === current.me?.id
  const unread = viewing || fromMe || current.unread.includes(message.channelId) ? current.unread : [...current.unread, message.channelId]
  return {
    ...current,
    messages: { ...current.messages, [message.channelId]: upsertMessage(current.messages[message.channelId], message) },
    dms: touchDm(current.dms, message, true),
    unread,
  }
}

function touchDm(dms: DirectMessage[], message: Message, move: boolean) {
  let found = false
  const next = dms.map((dm) => {
    if (dm.id !== message.channelId) return dm
    found = true
    const last = dm.lastMessage
    if (last && last.createdAt > message.createdAt) return dm
    return { ...dm, lastMessage: { id: message.id, content: message.content, createdAt: message.createdAt } }
  })
  if (!found) return dms
  if (!move) return next
  return [...next].sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
}

function removeMessage(current: AppData, messageId: string, channelId: string): AppData {
  const remaining = (current.messages[channelId] ?? []).filter((message) => message.id !== messageId)
  const dms = current.dms.map((dm) => {
    if (dm.id !== channelId) return dm
    if (dm.lastMessage?.id !== messageId) return dm
    const last = remaining[remaining.length - 1]
    return { ...dm, lastMessage: last ? { id: last.id, content: last.content, createdAt: last.createdAt } : null }
  })
  return { ...current, messages: { ...current.messages, [channelId]: remaining }, dms }
}

function addChannel(current: AppData, channel: Channel): AppData {
  if (!channel.serverId) return current
  return {
    ...current,
    servers: current.servers.map((server) => {
      if (server.id !== channel.serverId) return server
      if (server.channels.some((item) => item.id === channel.id)) return server
      return { ...server, channels: [...server.channels, channel].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt) }
    }),
  }
}

function removeChannel(current: AppData, serverId: string, channelId: string): AppData {
  const servers = current.servers.map((server) => {
    if (server.id !== serverId) return server
    return { ...server, channels: server.channels.filter((channel) => channel.id !== channelId) }
  })
  let view = current.view
  if (view.kind === 'server' && view.channelId === channelId) {
    const serverView = view
    const server = servers.find((item) => item.id === serverView.serverId)
    view = { kind: 'server', serverId: serverView.serverId, channelId: server?.channels[0]?.id ?? null }
  }
  const messages = { ...current.messages }
  delete messages[channelId]
  return { ...current, servers, view, messages, unread: current.unread.filter((id) => id !== channelId) }
}

function dropServer(current: AppData, serverId: string): AppData {
  const server = current.servers.find((item) => item.id === serverId)
  const channelIds = new Set(server?.channels.map((channel) => channel.id) ?? [])
  const messages = { ...current.messages }
  for (const channelId of channelIds) delete messages[channelId]
  const view = current.view.kind === 'server' && current.view.serverId === serverId ? { kind: 'home' as const, channelId: null } : current.view
  return {
    ...current,
    servers: current.servers.filter((item) => item.id !== serverId),
    view,
    messages,
    unread: current.unread.filter((id) => !channelIds.has(id)),
  }
}

function addMember(current: AppData, serverId: string, user: User): AppData {
  return {
    ...current,
    servers: current.servers.map((server) => {
      if (server.id !== serverId) return server
      if (server.members.some((member) => member.id === user.id)) return server
      return { ...server, members: [...server.members, user] }
    }),
  }
}

function removeMember(current: AppData, serverId: string, userId: string): AppData {
  return {
    ...current,
    servers: current.servers.map((server) =>
      server.id === serverId ? { ...server, members: server.members.filter((member) => member.id !== userId) } : server,
    ),
  }
}

function addDm(current: AppData, dm: DirectMessage): AppData {
  const existing = current.dms.find((item) => item.id === dm.id)
  const dms = existing
    ? current.dms.map((item) => (item.id === dm.id ? { ...dm, lastMessage: newerLast(item.lastMessage, dm.lastMessage) } : item))
    : [dm, ...current.dms]
  return { ...current, dms }
}

function newerLast(a: DirectMessage['lastMessage'], b: DirectMessage['lastMessage']) {
  if (!a) return b
  if (!b) return a
  return a.createdAt >= b.createdAt ? a : b
}

function applyUserPatch(current: AppData, patch: UserPatch): AppData {
  return {
    ...current,
    me: current.me ? patchUser(current.me, patch) : current.me,
    servers: current.servers.map((server) => ({ ...server, members: server.members.map((member) => patchUser(member, patch)) })),
    dms: current.dms.map((dm) => ({ ...dm, peer: patchUser(dm.peer, patch) })),
    messages: Object.fromEntries(
      Object.entries(current.messages).map(([channelId, messages]) => [
        channelId,
        messages.map((message) => ({ ...message, author: patchUser(message.author, patch) })),
      ]),
    ),
  }
}

function mergeChannels(remote: Channel[], local: Channel[]) {
  const seen = new Set<string>()
  const merged = remote.map((channel) => {
    seen.add(channel.id)
    return channel
  })
  for (const channel of local) if (!seen.has(channel.id)) merged.push(channel)
  return merged.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
}

function mergeUsers(remote: User[], local: User[]) {
  const seen = new Set(remote.map((user) => user.id))
  return [...remote, ...local.filter((user) => !seen.has(user.id))]
}

function mergeDms(remote: DirectMessage[], local: DirectMessage[]) {
  const localMap = new Map(local.map((dm) => [dm.id, dm]))
  const seen = new Set<string>()
  const merged = remote.map((dm) => {
    seen.add(dm.id)
    const previous = localMap.get(dm.id)
    return previous ? { ...dm, lastMessage: newerLast(previous.lastMessage, dm.lastMessage) } : dm
  })
  for (const dm of local) if (!seen.has(dm.id)) merged.push(dm)
  return merged.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0))
}

export function useRelay() {
  const value = useContext(RelayContext)
  if (!value) throw new Error('Relay is not ready.')
  return value
}
