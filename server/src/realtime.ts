import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { userIdFromToken } from './auth'
import {
  canAccessChannel,
  getUserById,
  listAccessibleChannelIds,
  listDmPeerIds,
  listRelatedUserIds,
  listServerIds,
  type Channel,
  type DirectMessage,
  type Message,
  type User,
} from './db'

type Presence = 'online' | 'offline'

let io: Server | null = null
const connectionCounts = new Map<string, number>()
const offlineTimers = new Map<string, NodeJS.Timeout>()

export function getIo() {
  return io
}

export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
    },
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    const userId = typeof token === 'string' ? userIdFromToken(token) : null
    const user = userId ? getUserById(userId) : null
    if (!user) {
      next(new Error('unauthorized'))
      return
    }
    socket.data.user = user
    next()
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as User
    joinUserRooms(socket, user.id)
    markConnected(user.id)
    socket.emit('presence:snapshot', { userIds: onlineRelatedUsers(user.id) })

    socket.on('typing', (payload: unknown) => {
      const channelId = typeof payload === 'object' && payload && 'channelId' in payload ? String(payload.channelId) : ''
      if (!channelId || !canAccessChannel(user.id, channelId)) return
      socket.to(`channel:${channelId}`).emit('typing', {
        channelId,
        userId: user.id,
        displayName: user.displayName,
      })
    })

    socket.on('disconnect', () => {
      markDisconnected(user.id)
    })
  })

  return io
}

function joinUserRooms(socket: Socket, userId: string) {
  socket.join(`user:${userId}`)
  for (const serverId of listServerIds(userId)) socket.join(`server:${serverId}`)
  for (const channelId of listAccessibleChannelIds(userId)) socket.join(`channel:${channelId}`)
}

function isOnline(userId: string) {
  return (connectionCounts.get(userId) ?? 0) > 0 || offlineTimers.has(userId)
}

function onlineRelatedUsers(userId: string) {
  const ids = new Set(listRelatedUserIds(userId).filter((id) => isOnline(id)))
  if (isOnline(userId)) ids.add(userId)
  return [...ids]
}

export function refreshPresence(userId: string) {
  if (isOnline(userId)) emitPresence(userId, 'online')
  getIo()?.to(`user:${userId}`).emit('presence:snapshot', { userIds: onlineRelatedUsers(userId) })
}

function emitPresence(userId: string, status: Presence) {
  const current = getIo()
  if (!current) return
  const payload = { userId, status }
  for (const serverId of listServerIds(userId)) current.to(`server:${serverId}`).emit('presence', payload)
  for (const peerId of listDmPeerIds(userId)) current.to(`user:${peerId}`).emit('presence', payload)
  current.to(`user:${userId}`).emit('presence', payload)
}

function markConnected(userId: string) {
  const next = (connectionCounts.get(userId) ?? 0) + 1
  connectionCounts.set(userId, next)
  const pending = offlineTimers.get(userId)
  if (pending) {
    clearTimeout(pending)
    offlineTimers.delete(userId)
  }
  if (next === 1) emitPresence(userId, 'online')
}

function markDisconnected(userId: string) {
  const next = (connectionCounts.get(userId) ?? 1) - 1
  if (next <= 0) connectionCounts.delete(userId)
  else connectionCounts.set(userId, next)
  if (next > 0) return
  const timer = setTimeout(() => {
    offlineTimers.delete(userId)
    if ((connectionCounts.get(userId) ?? 0) === 0) emitPresence(userId, 'offline')
  }, 2000)
  offlineTimers.set(userId, timer)
}

async function joinChannelForServer(serverId: string, channelId: string) {
  const current = getIo()
  if (!current) return
  const sockets = await current.in(`server:${serverId}`).fetchSockets()
  for (const socket of sockets) socket.join(`channel:${channelId}`)
}

async function joinUsersToChannel(userIds: string[], channelId: string) {
  const current = getIo()
  if (!current) return
  for (const userId of userIds) {
    const sockets = await current.in(`user:${userId}`).fetchSockets()
    for (const socket of sockets) socket.join(`channel:${channelId}`)
  }
}

export async function subscribeUserToServer(userId: string, serverId: string, channelIds: string[]) {
  await joinUserToServer(userId, serverId, channelIds)
  refreshPresence(userId)
}

async function joinUserToServer(userId: string, serverId: string, channelIds: string[]) {
  const current = getIo()
  if (!current) return
  const sockets = await current.in(`user:${userId}`).fetchSockets()
  for (const socket of sockets) {
    socket.join(`server:${serverId}`)
    for (const channelId of channelIds) socket.join(`channel:${channelId}`)
  }
}

async function leaveUserRooms(userId: string, serverId: string, channelIds: string[]) {
  const current = getIo()
  if (!current) return
  const sockets = await current.in(`user:${userId}`).fetchSockets()
  for (const socket of sockets) {
    socket.leave(`server:${serverId}`)
    for (const channelId of channelIds) socket.leave(`channel:${channelId}`)
  }
}

export function broadcastMessageCreated(message: Message) {
  getIo()?.to(`channel:${message.channelId}`).emit('message:created', message)
}

export function broadcastMessageUpdated(message: Message) {
  getIo()?.to(`channel:${message.channelId}`).emit('message:updated', message)
}

export function broadcastMessageDeleted(payload: { id: string; channelId: string }) {
  getIo()?.to(`channel:${payload.channelId}`).emit('message:deleted', payload)
}

export async function broadcastChannelCreated(channel: Channel, actorId?: string) {
  if (!channel.serverId) return
  await joinChannelForServer(channel.serverId, channel.id)
  if (actorId) await joinUsersToChannel([actorId], channel.id)
  getIo()?.to(`server:${channel.serverId}`).emit('channel:created', channel)
}

export function broadcastChannelDeleted(channel: Channel) {
  if (!channel.serverId) return
  getIo()?.to(`server:${channel.serverId}`).emit('channel:deleted', { id: channel.id, serverId: channel.serverId })
}

export async function broadcastMemberJoined(serverId: string, user: User, channelIds: string[]) {
  await joinUserToServer(user.id, serverId, channelIds)
  getIo()?.to(`server:${serverId}`).emit('member:joined', { serverId, user })
  refreshPresence(user.id)
}

export async function broadcastMemberLeft(serverId: string, userId: string, channelIds: string[], ownerId: string | null, deleted: boolean) {
  const current = getIo()
  if (deleted) {
    current?.to(`server:${serverId}`).emit('server:deleted', { id: serverId })
  } else {
    current?.to(`server:${serverId}`).emit('member:left', { serverId, userId })
    if (ownerId) current?.to(`server:${serverId}`).emit('server:updated', { id: serverId, ownerId })
  }
  await leaveUserRooms(userId, serverId, channelIds)
}

export function broadcastServerDeleted(serverId: string) {
  getIo()?.to(`server:${serverId}`).emit('server:deleted', { id: serverId })
}

export async function broadcastDirectMessage(input: { channelId: string; userId: string; peerId: string; mine: DirectMessage; theirs: DirectMessage }) {
  await joinUsersToChannel([input.userId, input.peerId], input.channelId)
  const current = getIo()
  current?.to(`user:${input.userId}`).emit('dm:created', input.mine)
  current?.to(`user:${input.peerId}`).emit('dm:created', input.theirs)
}

export function broadcastUserUpdated(user: User) {
  const current = getIo()
  if (!current) return
  const payload = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
  }
  current.to(`user:${user.id}`).emit('user:updated', payload)
  for (const serverId of listServerIds(user.id)) current.to(`server:${serverId}`).emit('user:updated', payload)
  for (const peerId of listDmPeerIds(user.id)) current.to(`user:${peerId}`).emit('user:updated', payload)
}
