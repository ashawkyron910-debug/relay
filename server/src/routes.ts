import { Router, type Request, type Response, type NextFunction } from 'express'
import { bearerToken, hashPassword, signToken, userIdFromToken, verifyPassword } from './auth'
import {
  canAccessChannel,
  createChannel,
  createMessage,
  createServer,
  createUser,
  deleteChannel,
  deleteMessage,
  deleteServer,
  getAuthUser,
  getUserById,
  getUserByUsername,
  isUniqueConstraint,
  joinServer,
  leaveServer,
  listDirectMessages,
  listMessages,
  listServersForUser,
  openDirectMessage,
  updateDisplayName,
  updateMessage,
  type User,
} from './db'
import {
  broadcastChannelCreated,
  broadcastChannelDeleted,
  broadcastDirectMessage,
  broadcastMemberJoined,
  broadcastMemberLeft,
  broadcastMessageCreated,
  broadcastMessageDeleted,
  broadcastMessageUpdated,
  broadcastServerDeleted,
  broadcastUserUpdated,
  subscribeUserToServer,
} from './realtime'

const attempts = new Map<string, { count: number; reset: number }>()
const sends = new Map<string, number[]>()

function tooManyAuthAttempts(ip: string) {
  const now = Date.now()
  const row = attempts.get(ip)
  if (!row || now > row.reset) {
    attempts.set(ip, { count: 1, reset: now + 60_000 })
    return false
  }
  row.count += 1
  return row.count > 20
}

function allowSend(userId: string) {
  const now = Date.now()
  const recent = (sends.get(userId) ?? []).filter((stamp) => now - stamp < 5000)
  if (recent.length >= 8) {
    sends.set(userId, recent)
    return false
  }
  recent.push(now)
  sends.set(userId, recent)
  return true
}

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\r/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

function singleLine(value: unknown, max: number) {
  const cleaned = text(value, max)
  if (!cleaned) return null
  return cleaned.replace(/[\n\t]/g, ' ').trim() || null
}

function usernameOf(value: unknown) {
  if (typeof value !== 'string') return null
  const username = value.trim()
  if (!/^[a-zA-Z0-9_]{2,32}$/.test(username)) return null
  return username
}

function channelNameOf(value: unknown) {
  if (typeof value !== 'string') return null
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || null
}

function userFrom(req: Request) {
  const token = bearerToken(req.header('authorization'))
  if (!token) return null
  const userId = userIdFromToken(token)
  if (!userId) return null
  return getUserById(userId)
}

function authed(handler: (req: Request, res: Response, user: User) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(async () => {
        const user = userFrom(req)
        if (!user) {
          res.status(401).json({ error: 'Sign in required.' })
          return
        }
        await handler(req, res, user)
      })
      .catch(next)
  }
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  }
}

export function createRouter() {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ ok: true, name: 'relay', version: '0.1.0' })
  })

  router.post('/auth/register', async (req, res) => {
    if (tooManyAuthAttempts(req.ip || 'local')) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' })
      return
    }
    const username = usernameOf(req.body?.username)
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const displayName = singleLine(req.body?.displayName, 32) || username
    if (!username) {
      res.status(400).json({ error: 'Usernames are 2–32 characters: letters, numbers, and underscores.' })
      return
    }
    if (password.length < 8 || password.length > 200) {
      res.status(400).json({ error: 'Use a password between 8 and 200 characters.' })
      return
    }
    try {
      const user = createUser({
        username,
        displayName: displayName || username,
        passwordHash: await hashPassword(password),
      })
      res.status(201).json({ token: signToken(user.id), user: publicUser(user) })
    } catch (error) {
      if (isUniqueConstraint(error)) {
        res.status(409).json({ error: 'That username is taken.' })
        return
      }
      throw error
    }
  })

  router.post('/auth/login', async (req, res) => {
    if (tooManyAuthAttempts(req.ip || 'local')) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' })
      return
    }
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const auth = username ? getAuthUser(username) : null
    if (!auth || !(await verifyPassword(password, auth.passwordHash))) {
      res.status(401).json({ error: 'That username and password did not match.' })
      return
    }
    res.json({ token: signToken(auth.user.id), user: publicUser(auth.user) })
  })

  router.get('/me', authed((_req, res, user) => {
    res.json({ user: publicUser(user) })
  }))

  router.patch('/me', authed((_req, res, user) => {
    const displayName = singleLine(_req.body?.displayName, 32)
    if (!displayName) {
      res.status(400).json({ error: 'Enter a display name.' })
      return
    }
    const updated = updateDisplayName(user.id, displayName)
    if (!updated) {
      res.status(404).json({ error: 'Account not found.' })
      return
    }
    broadcastUserUpdated(updated)
    res.json({ user: publicUser(updated) })
  }))

  router.get('/bootstrap', authed((_req, res, user) => {
    res.json({
      user: publicUser(user),
      servers: listServersForUser(user.id),
      dms: listDirectMessages(user.id),
    })
  }))

  router.post('/servers', authed(async (req, res, user) => {
    const name = singleLine(req.body?.name, 80)
    if (!name) {
      res.status(400).json({ error: 'Give the server a name.' })
      return
    }
    const server = createServer(user.id, name)
    await subscribeUserToServer(user.id, server.id, server.channels.map((channel) => channel.id))
    res.status(201).json({ server })
  }))

  router.post('/invites/:code/join', authed(async (req, res, user) => {
    const result = joinServer(user.id, String(req.params.code || ''))
    if (result.error === 'missing' || !result.server) {
      res.status(404).json({ error: 'That invite code does not match a server.' })
      return
    }
    if (!result.alreadyMember) {
      await broadcastMemberJoined(result.server.id, publicUser(user), result.server.channels.map((channel) => channel.id))
    }
    res.json({ server: result.server })
  }))

  router.post('/servers/:serverId/leave', authed(async (req, res, user) => {
    const result = leaveServer(user.id, String(req.params.serverId || ''))
    if (result.error === 'missing') {
      res.status(404).json({ error: 'Server not found.' })
      return
    }
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'You are not in that server.' })
      return
    }
    await broadcastMemberLeft(String(req.params.serverId), user.id, result.channelIds, result.ownerId, result.deleted)
    res.json({ ok: true, deleted: result.deleted, ownerId: result.ownerId })
  }))

  router.delete('/servers/:serverId', authed(async (req, res, user) => {
    const serverId = String(req.params.serverId || '')
    const result = deleteServer(user.id, serverId)
    if (result.error === 'missing') {
      res.status(404).json({ error: 'Server not found.' })
      return
    }
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'Only the server owner can delete it.' })
      return
    }
    broadcastServerDeleted(serverId)
    res.json({ ok: true })
  }))

  router.post('/servers/:serverId/channels', authed(async (req, res, user) => {
    const name = channelNameOf(req.body?.name)
    if (!name) {
      res.status(400).json({ error: 'Use letters or numbers in the channel name.' })
      return
    }
    const result = createChannel(user.id, String(req.params.serverId || ''), name)
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'Join the server before adding a channel.' })
      return
    }
    if (result.error === 'duplicate') {
      res.status(409).json({ error: 'That channel already exists.' })
      return
    }
    await broadcastChannelCreated(result.channel, user.id)
    res.status(201).json({ channel: result.channel })
  }))

  router.delete('/channels/:channelId', authed((req, res, user) => {
    const result = deleteChannel(user.id, String(req.params.channelId || ''))
    if (result.error === 'missing') {
      res.status(404).json({ error: 'Channel not found.' })
      return
    }
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'Only the server owner can delete channels.' })
      return
    }
    if (result.error === 'last') {
      res.status(400).json({ error: 'A server needs at least one channel.' })
      return
    }
    broadcastChannelDeleted(result.channel)
    res.json({ ok: true })
  }))

  router.get('/channels/:channelId/messages', authed((req, res, user) => {
    const channel = canAccessChannel(user.id, String(req.params.channelId || ''))
    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' })
      return
    }
    const requested = Number(req.query.limit)
    const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 50
    const hasBefore = typeof req.query.before === 'string' && req.query.before !== ''
    const hasBeforeId = typeof req.query.beforeId === 'string' && req.query.beforeId !== ''
    if (hasBefore !== hasBeforeId) {
      res.status(400).json({ error: 'That page cursor is not valid.' })
      return
    }
    let before: { createdAt: number; id: string } | null = null
    if (hasBefore && hasBeforeId) {
      const createdAt = Number(req.query.before)
      const id = String(req.query.beforeId)
      if (!Number.isFinite(createdAt) || !id) {
        res.status(400).json({ error: 'That page cursor is not valid.' })
        return
      }
      before = { createdAt, id }
    }
    res.json(listMessages(channel.id, limit, before))
  }))

  router.post('/channels/:channelId/messages', authed((req, res, user) => {
    const channel = canAccessChannel(user.id, String(req.params.channelId || ''))
    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' })
      return
    }
    if (!allowSend(user.id)) {
      res.status(429).json({ error: 'Slow down a little, then send again.' })
      return
    }
    if (typeof req.body?.content === 'string' && req.body.content.trim().length > 2000) {
      res.status(400).json({ error: 'Messages can be up to 2000 characters.' })
      return
    }
    const content = text(req.body?.content, 2000)
    if (!content) {
      res.status(400).json({ error: 'Write a message first.' })
      return
    }
    const message = createMessage(channel.id, user.id, content)
    broadcastMessageCreated(message)
    res.status(201).json({ message })
  }))

  router.patch('/messages/:messageId', authed((req, res, user) => {
    if (typeof req.body?.content === 'string' && req.body.content.trim().length > 2000) {
      res.status(400).json({ error: 'Messages can be up to 2000 characters.' })
      return
    }
    const content = text(req.body?.content, 2000)
    if (!content) {
      res.status(400).json({ error: 'Message text cannot be empty.' })
      return
    }
    const result = updateMessage(user.id, String(req.params.messageId || ''), content)
    if (result.error === 'missing') {
      res.status(404).json({ error: 'Message not found.' })
      return
    }
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'You can edit your own messages.' })
      return
    }
    broadcastMessageUpdated(result.message)
    res.json({ message: result.message })
  }))

  router.delete('/messages/:messageId', authed((req, res, user) => {
    const result = deleteMessage(user.id, String(req.params.messageId || ''))
    if (result.error === 'missing') {
      res.status(404).json({ error: 'Message not found.' })
      return
    }
    if (result.error === 'forbidden') {
      res.status(403).json({ error: 'You can delete your own messages.' })
      return
    }
    broadcastMessageDeleted({ id: result.message.id, channelId: result.message.channelId })
    res.json({ ok: true, id: result.message.id, channelId: result.message.channelId })
  }))

  router.post('/dms', authed(async (req, res, user) => {
    const username = usernameOf(req.body?.username)
    if (!username) {
      res.status(400).json({ error: 'Enter a username.' })
      return
    }
    const peer = getUserByUsername(username)
    if (!peer) {
      res.status(404).json({ error: 'No user with that name.' })
      return
    }
    const opened = openDirectMessage(user.id, peer)
    if (opened.error === 'self') {
      res.status(400).json({ error: "You can't message yourself." })
      return
    }
    if (opened.error) {
      res.status(500).json({ error: 'Could not open that conversation.' })
      return
    }
    await broadcastDirectMessage({
      channelId: opened.channelId,
      userId: user.id,
      peerId: opened.peerId,
      mine: opened.mine,
      theirs: opened.theirs,
    })
    res.status(201).json({ dm: opened.mine })
  }))

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error)
      return
    }
    console.error(error)
    res.status(500).json({ error: 'Something went wrong.' })
  })

  return router
}
