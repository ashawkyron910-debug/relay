import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { ensureDataDirectory } from './paths'

const COLORS = ['#5865f2', '#57f287', '#fee75c', '#eb459e', '#ed4245', '#3ba55d', '#faa61a', '#9b59b6', '#1abc9c', '#e67e22']

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

export type Message = {
  id: string
  channelId: string
  content: string
  createdAt: number
  editedAt: number | null
  author: User
}

export type DirectMessage = {
  id: string
  peer: User
  lastMessage: { id: string; content: string; createdAt: number } | null
}

export type ServerBundle = {
  id: string
  name: string
  ownerId: string
  inviteCode: string
  iconColor: string
  createdAt: number
  channels: Channel[]
  members: User[]
}

type UserRow = {
  id: string
  username: string
  display_name: string
  avatar_color: string
  created_at: number
  password_hash?: string
}

type ChannelRow = {
  id: string
  server_id: string | null
  name: string
  kind: 'text' | 'dm'
  position: number
  created_at: number
}

type ServerRow = {
  id: string
  name: string
  owner_id: string
  invite_code: string
  icon_color: string
  created_at: number
}

const dataDir = ensureDataDirectory()
const db = new Database(path.join(dataDir, 'relay.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT NOT NULL UNIQUE,
    icon_color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memberships (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'dm')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dm_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS dm_pairs (
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
    PRIMARY KEY (user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
`)

function pickColor() {
  return COLORS[randomBytes(1)[0] % COLORS.length]
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  }
}

function mapChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    kind: row.kind,
    position: row.position,
    createdAt: row.created_at,
  }
}

export function isUniqueConstraint(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code).includes('CONSTRAINT')
  )
}

export function createUser(input: { username: string; displayName: string; passwordHash: string }) {
  const user: User = {
    id: randomUUID(),
    username: input.username.toLowerCase(),
    displayName: input.displayName,
    avatarColor: pickColor(),
    createdAt: Date.now(),
  }
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
     VALUES (@id, @username, @displayName, @passwordHash, @avatarColor, @createdAt)`,
  ).run({ ...user, passwordHash: input.passwordHash })
  return user
}

export function getUserById(id: string) {
  const row = db.prepare(
    `SELECT id, username, display_name, avatar_color, created_at FROM users WHERE id = ?`,
  ).get(id) as UserRow | undefined
  return row ? mapUser(row) : null
}

export function getUserByUsername(username: string) {
  const row = db.prepare(
    `SELECT id, username, display_name, avatar_color, created_at FROM users WHERE username = ?`,
  ).get(username.toLowerCase()) as UserRow | undefined
  return row ? mapUser(row) : null
}

export function getAuthUser(username: string) {
  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username.toLowerCase()) as
    | (UserRow & { password_hash: string })
    | undefined
  if (!row || !row.password_hash) return null
  return { user: mapUser(row), passwordHash: row.password_hash }
}

export function updateDisplayName(userId: string, displayName: string) {
  db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName, userId)
  return getUserById(userId)
}

function inviteCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i += 1) code += alphabet[bytes[i] % alphabet.length]
  return code
}

function listChannels(serverId: string) {
  const rows = db.prepare(
    `SELECT * FROM channels WHERE server_id = ? AND kind = 'text' ORDER BY position ASC, created_at ASC`,
  ).all(serverId) as ChannelRow[]
  return rows.map(mapChannel)
}

function listMembers(serverId: string) {
  const rows = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.created_at
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE m.server_id = ?
     ORDER BY m.joined_at ASC`,
  ).all(serverId) as UserRow[]
  return rows.map(mapUser)
}

function hydrateServer(row: ServerRow): ServerBundle {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    iconColor: row.icon_color,
    createdAt: row.created_at,
    channels: listChannels(row.id),
    members: listMembers(row.id),
  }
}

export function createServer(ownerId: string, name: string) {
  const created = db.transaction(() => {
    const id = randomUUID()
    const createdAt = Date.now()
    let stored = false
    for (let attempt = 0; attempt < 5 && !stored; attempt += 1) {
      try {
        db.prepare(
          `INSERT INTO servers (id, name, owner_id, invite_code, icon_color, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, name, ownerId, inviteCode(), pickColor(), createdAt)
        stored = true
      } catch (error) {
        if (!isUniqueConstraint(error) || attempt === 4) throw error
      }
    }
    db.prepare(`INSERT INTO memberships (server_id, user_id, joined_at) VALUES (?, ?, ?)`).run(id, ownerId, createdAt)
    db.prepare(
      `INSERT INTO channels (id, server_id, name, kind, position, created_at)
       VALUES (?, ?, 'general', 'text', 0, ?)`,
    ).run(randomUUID(), id, createdAt)
    const row = db.prepare(`SELECT * FROM servers WHERE id = ?`).get(id) as ServerRow
    return hydrateServer(row)
  })
  return created()
}

export function listServersForUser(userId: string) {
  const rows = db.prepare(
    `SELECT s.* FROM servers s
     JOIN memberships m ON m.server_id = s.id
     WHERE m.user_id = ?
     ORDER BY s.created_at ASC`,
  ).all(userId) as ServerRow[]
  return rows.map(hydrateServer)
}

export function getServer(serverId: string) {
  const row = db.prepare(`SELECT * FROM servers WHERE id = ?`).get(serverId) as ServerRow | undefined
  return row ? hydrateServer(row) : null
}

export function getServerByInvite(code: string) {
  const row = db.prepare(`SELECT * FROM servers WHERE invite_code = ?`).get(code.trim().toLowerCase()) as
    | ServerRow
    | undefined
  return row ? hydrateServer(row) : null
}

export function isMember(serverId: string, userId: string) {
  const row = db.prepare(`SELECT 1 AS ok FROM memberships WHERE server_id = ? AND user_id = ?`).get(serverId, userId) as
    | { ok: number }
    | undefined
  return Boolean(row)
}

export function joinServer(userId: string, code: string) {
  const server = getServerByInvite(code)
  if (!server) return { error: 'missing' as const }
  if (isMember(server.id, userId)) return { error: null, server: getServer(server.id)!, alreadyMember: true }
  db.prepare(`INSERT INTO memberships (server_id, user_id, joined_at) VALUES (?, ?, ?)`).run(server.id, userId, Date.now())
  return { error: null, server: getServer(server.id)!, alreadyMember: false }
}

export function leaveServer(userId: string, serverId: string) {
  const existing = db.prepare(`SELECT owner_id FROM servers WHERE id = ?`).get(serverId) as { owner_id: string } | undefined
  if (!existing) return { error: 'missing' as const }
  if (!isMember(serverId, userId)) return { error: 'forbidden' as const }
  const channelIds = (db.prepare(`SELECT id FROM channels WHERE server_id = ?`).all(serverId) as { id: string }[]).map((row) => row.id)
  const result = db.transaction(() => {
    db.prepare(`DELETE FROM memberships WHERE server_id = ? AND user_id = ?`).run(serverId, userId)
    const remaining = db.prepare(
      `SELECT user_id FROM memberships WHERE server_id = ? ORDER BY joined_at ASC`,
    ).all(serverId) as { user_id: string }[]
    if (remaining.length === 0) {
      db.prepare(`DELETE FROM servers WHERE id = ?`).run(serverId)
      return { deleted: true, ownerId: null as string | null }
    }
    let ownerId = existing.owner_id
    if (existing.owner_id === userId) {
      ownerId = remaining[0].user_id
      db.prepare(`UPDATE servers SET owner_id = ? WHERE id = ?`).run(ownerId, serverId)
    }
    return { deleted: false, ownerId }
  })()
  return { error: null, channelIds, ...result }
}

export function deleteServer(userId: string, serverId: string) {
  const existing = db.prepare(`SELECT owner_id FROM servers WHERE id = ?`).get(serverId) as { owner_id: string } | undefined
  if (!existing) return { error: 'missing' as const }
  if (existing.owner_id !== userId) return { error: 'forbidden' as const }
  const channelIds = (db.prepare(`SELECT id FROM channels WHERE server_id = ?`).all(serverId) as { id: string }[]).map((row) => row.id)
  db.prepare(`DELETE FROM servers WHERE id = ?`).run(serverId)
  return { error: null, channelIds }
}

export function createChannel(userId: string, serverId: string, name: string) {
  if (!isMember(serverId, userId)) return { error: 'forbidden' as const }
  const duplicate = db.prepare(
    `SELECT id FROM channels WHERE server_id = ? AND kind = 'text' AND lower(name) = lower(?)`,
  ).get(serverId, name) as { id: string } | undefined
  if (duplicate) return { error: 'duplicate' as const }
  const positionRow = db.prepare(`SELECT COALESCE(MAX(position), -1) AS position FROM channels WHERE server_id = ?`).get(serverId) as {
    position: number
  }
  const channel: Channel = {
    id: randomUUID(),
    serverId,
    name,
    kind: 'text',
    position: positionRow.position + 1,
    createdAt: Date.now(),
  }
  db.prepare(
    `INSERT INTO channels (id, server_id, name, kind, position, created_at) VALUES (?, ?, ?, 'text', ?, ?)`,
  ).run(channel.id, serverId, channel.name, channel.position, channel.createdAt)
  return { error: null, channel }
}

export function deleteChannel(userId: string, channelId: string) {
  const channel = getChannel(channelId)
  if (!channel || channel.kind !== 'text' || !channel.serverId) return { error: 'missing' as const }
  const server = db.prepare(`SELECT owner_id FROM servers WHERE id = ?`).get(channel.serverId) as { owner_id: string } | undefined
  if (!server) return { error: 'missing' as const }
  if (server.owner_id !== userId) return { error: 'forbidden' as const }
  const count = db.prepare(`SELECT COUNT(*) AS count FROM channels WHERE server_id = ? AND kind = 'text'`).get(channel.serverId) as {
    count: number
  }
  if (count.count <= 1) return { error: 'last' as const }
  db.prepare(`DELETE FROM channels WHERE id = ?`).run(channelId)
  return { error: null, channel }
}

export function getChannel(channelId: string) {
  const row = db.prepare(`SELECT * FROM channels WHERE id = ?`).get(channelId) as ChannelRow | undefined
  return row ? mapChannel(row) : null
}

export function listChannelRecipientIds(channelId: string) {
  const channel = getChannel(channelId)
  if (!channel) return []
  if (channel.kind === 'text' && channel.serverId) return listMembers(channel.serverId).map((member) => member.id)
  return (db.prepare(`SELECT user_id FROM dm_members WHERE channel_id = ?`).all(channelId) as { user_id: string }[]).map((row) => row.user_id)
}

export function canAccessChannel(userId: string, channelId: string) {
  const channel = getChannel(channelId)
  if (!channel) return null
  if (channel.kind === 'text') {
    if (!channel.serverId || !isMember(channel.serverId, userId)) return null
    return channel
  }
  const member = db.prepare(`SELECT 1 AS ok FROM dm_members WHERE channel_id = ? AND user_id = ?`).get(channelId, userId) as
    | { ok: number }
    | undefined
  return member ? channel : null
}

function mapMessage(row: {
  id: string
  channel_id: string
  content: string
  created_at: number
  edited_at: number | null
  author_id: string
  username: string
  display_name: string
  avatar_color: string
  author_created_at: number
}): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      createdAt: row.author_created_at,
    },
  }
}

const messageSelect = `
  SELECT m.id, m.channel_id, m.content, m.created_at, m.edited_at,
         u.id AS author_id, u.username, u.display_name, u.avatar_color, u.created_at AS author_created_at
  FROM messages m
  JOIN users u ON u.id = m.author_id
`

export function listMessages(channelId: string, limit: number, before: { createdAt: number; id: string } | null) {
  const rows = db.prepare(
    `${messageSelect}
     WHERE m.channel_id = ?
       AND (
         ? IS NULL
         OR m.created_at < ?
         OR (m.created_at = ? AND m.id < ?)
       )
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ?`,
  ).all(
    channelId,
    before?.createdAt ?? null,
    before?.createdAt ?? null,
    before?.createdAt ?? null,
    before?.id ?? null,
    limit + 1,
  ) as Parameters<typeof mapMessage>[0][]
  const hasMore = rows.length > limit
  return { messages: rows.slice(0, limit).map(mapMessage).reverse(), hasMore }
}

export function createMessage(channelId: string, authorId: string, content: string) {
  const id = randomUUID()
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, content, created_at, edited_at) VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, channelId, authorId, content, createdAt)
  return getMessage(id)!
}

export function getMessage(messageId: string) {
  const row = db.prepare(`${messageSelect} WHERE m.id = ?`).get(messageId) as Parameters<typeof mapMessage>[0] | undefined
  return row ? mapMessage(row) : null
}

export function updateMessage(userId: string, messageId: string, content: string) {
  const existing = getMessage(messageId)
  if (!existing) return { error: 'missing' as const }
  if (existing.author.id !== userId || !canAccessChannel(userId, existing.channelId)) return { error: 'forbidden' as const }
  db.prepare(`UPDATE messages SET content = ?, edited_at = ? WHERE id = ?`).run(content, Date.now(), messageId)
  return { error: null, message: getMessage(messageId)! }
}

export function deleteMessage(userId: string, messageId: string) {
  const existing = getMessage(messageId)
  if (!existing) return { error: 'missing' as const }
  if (existing.author.id !== userId || !canAccessChannel(userId, existing.channelId)) return { error: 'forbidden' as const }
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId)
  return { error: null, message: existing }
}

function pairKey(a: string, b: string) {
  return a < b ? [a, b] : [b, a]
}

function directMessageFor(channelId: string, viewerId: string): DirectMessage | null {
  const row = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.created_at,
            lm.id AS last_id, lm.content AS last_content, lm.created_at AS last_created_at
     FROM dm_members mine
     JOIN dm_members theirs ON theirs.channel_id = mine.channel_id AND theirs.user_id != mine.user_id
     JOIN users u ON u.id = theirs.user_id
     LEFT JOIN messages lm ON lm.id = (
       SELECT id FROM messages WHERE channel_id = mine.channel_id ORDER BY created_at DESC LIMIT 1
     )
     WHERE mine.channel_id = ? AND mine.user_id = ?`,
  ).get(channelId, viewerId) as
    | (UserRow & { last_id: string | null; last_content: string | null; last_created_at: number | null })
    | undefined
  if (!row) return null
  return {
    id: channelId,
    peer: mapUser(row),
    lastMessage: row.last_id && row.last_content && row.last_created_at
      ? { id: row.last_id, content: row.last_content, createdAt: row.last_created_at }
      : null,
  }
}

export function listDirectMessages(userId: string) {
  const rows = db.prepare(
    `SELECT c.id AS channel_id, COALESCE(lm.created_at, c.created_at) AS activity
     FROM channels c
     JOIN dm_members mine ON mine.channel_id = c.id AND mine.user_id = ?
     LEFT JOIN messages lm ON lm.id = (
       SELECT id FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE c.kind = 'dm'
     ORDER BY activity DESC`,
  ).all(userId) as { channel_id: string }[]
  return rows
    .map((row) => directMessageFor(row.channel_id, userId))
    .filter((row): row is DirectMessage => Boolean(row))
}

function directMessageResult(channelId: string, userId: string, peerId: string) {
  const mine = directMessageFor(channelId, userId)
  const theirs = directMessageFor(channelId, peerId)
  if (!mine || !theirs) return { error: 'missing' as const }
  return { error: null, channelId, mine, theirs, peerId }
}

export function openDirectMessage(userId: string, peer: User) {
  if (peer.id === userId) return { error: 'self' as const }
  const [userA, userB] = pairKey(userId, peer.id)
  const existing = db.prepare(`SELECT channel_id FROM dm_pairs WHERE user_a = ? AND user_b = ?`).get(userA, userB) as
    | { channel_id: string }
    | undefined
  if (existing) return directMessageResult(existing.channel_id, userId, peer.id)

  try {
    const channelId = db.transaction(() => {
      const again = db.prepare(`SELECT channel_id FROM dm_pairs WHERE user_a = ? AND user_b = ?`).get(userA, userB) as
        | { channel_id: string }
        | undefined
      if (again) return again.channel_id
      const createdId = randomUUID()
      const createdAt = Date.now()
      db.prepare(
        `INSERT INTO channels (id, server_id, name, kind, position, created_at) VALUES (?, NULL, 'dm', 'dm', 0, ?)`,
      ).run(createdId, createdAt)
      db.prepare(`INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)`).run(createdId, userId)
      db.prepare(`INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)`).run(createdId, peer.id)
      db.prepare(`INSERT INTO dm_pairs (user_a, user_b, channel_id) VALUES (?, ?, ?)`).run(userA, userB, createdId)
      return createdId
    })()
    return directMessageResult(channelId, userId, peer.id)
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error
    const raced = db.prepare(`SELECT channel_id FROM dm_pairs WHERE user_a = ? AND user_b = ?`).get(userA, userB) as
      | { channel_id: string }
      | undefined
    if (!raced) return { error: 'missing' as const }
    return directMessageResult(raced.channel_id, userId, peer.id)
  }
}

export function listServerIds(userId: string) {
  return (db.prepare(`SELECT server_id FROM memberships WHERE user_id = ?`).all(userId) as { server_id: string }[]).map(
    (row) => row.server_id,
  )
}

export function listAccessibleChannelIds(userId: string) {
  const rows = db.prepare(
    `SELECT c.id FROM channels c
     JOIN memberships m ON m.server_id = c.server_id
     WHERE m.user_id = ? AND c.kind = 'text'
     UNION
     SELECT c.id FROM channels c
     JOIN dm_members d ON d.channel_id = c.id
     WHERE d.user_id = ? AND c.kind = 'dm'`,
  ).all(userId, userId) as { id: string }[]
  return rows.map((row) => row.id)
}

export function listRelatedUserIds(userId: string) {
  const rows = db.prepare(
    `SELECT DISTINCT m2.user_id AS id
     FROM memberships m1
     JOIN memberships m2 ON m2.server_id = m1.server_id
     WHERE m1.user_id = ?
     UNION
     SELECT other.user_id AS id
     FROM dm_members mine
     JOIN dm_members other ON other.channel_id = mine.channel_id AND other.user_id != mine.user_id
     WHERE mine.user_id = ?`,
  ).all(userId, userId) as { id: string }[]
  return rows.map((row) => row.id)
}

export function listDmPeerIds(userId: string) {
  const rows = db.prepare(
    `SELECT other.user_id AS id
     FROM dm_members mine
     JOIN dm_members other ON other.channel_id = mine.channel_id AND other.user_id != mine.user_id
     WHERE mine.user_id = ?`,
  ).all(userId) as { id: string }[]
  return rows.map((row) => row.id)
}

export function databaseFile() {
  return path.join(dataDir, 'relay.db')
}

export function closeDatabase() {
  db.close()
}
