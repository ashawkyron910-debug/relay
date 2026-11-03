import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 4017
const base = `http://127.0.0.1:${port}`
const dataDir = await mkdtemp(path.join(tmpdir(), 'relay-smoke-'))
const stamp = Date.now().toString(36)

const server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), RELAY_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let logs = ''
server.stdout?.on('data', (chunk) => {
  logs += chunk.toString()
})
server.stderr?.on('data', (chunk) => {
  logs += chunk.toString()
})

try {
  await waitForHealth()
  const ada = await register(`ada_${stamp}`, 'Ada')
  const bea = await register(`bea_${stamp}`, 'Bea')
  const created = await send(ada.token, '/api/servers', { name: 'Launch pad' })
  const serverId = created.server.id
  const generalId = created.server.channels[0].id
  if (!created.server.inviteCode || generalId == null) throw new Error('Server was created without a channel or invite.')

  const joined = await send(bea.token, `/api/invites/${created.server.inviteCode}/join`, {})
  if (joined.server.id !== serverId) throw new Error('Invite joined the wrong server.')

  const adaSocket = await connect(ada.token)
  const seen = waitFor(adaSocket, 'message:created')
  const sent = await send(bea.token, `/api/channels/${generalId}/messages`, { content: 'Hello from Bea' })
  const live = await seen
  if (live.id !== sent.message.id) throw new Error('Realtime message did not match the saved message.')

  const edited = await send(bea.token, `/api/messages/${sent.message.id}`, { content: 'Hello, edited' }, 'PATCH')
  if (edited.message.editedAt == null) throw new Error('Edited message was not marked edited.')

  await send(bea.token, `/api/messages/${sent.message.id}`, undefined, 'DELETE')
  const history = await send(ada.token, `/api/channels/${generalId}/messages`, undefined, 'GET')
  if (history.messages.some((message) => message.id === sent.message.id)) throw new Error('Deleted message is still in history.')

  const beaSocket = await connect(bea.token)
  const dmEvent = waitFor(beaSocket, 'dm:created')
  const dm = await send(ada.token, '/api/dms', { username: bea.user.username })
  const opened = await dmEvent
  if (opened.id !== dm.dm.id) throw new Error('Direct message was not delivered live.')
  await send(ada.token, `/api/channels/${dm.dm.id}/messages`, { content: 'private hello' })

  const channelEvent = waitFor(beaSocket, 'channel:created')
  const channel = await send(ada.token, `/api/servers/${serverId}/channels`, { name: 'Release Notes' })
  const createdChannel = await channelEvent
  if (createdChannel.name !== 'release-notes') throw new Error(`Channel name was ${createdChannel.name}, expected release-notes.`)

  const denied = await fetch(`${base}/api/channels/${channel.channel.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${bea.token}` },
  })
  if (denied.status !== 403) throw new Error(`Non-owner delete returned ${denied.status}.`)

  const badLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ada.user.username, password: 'not-the-password' }),
  })
  if (badLogin.status !== 401) throw new Error(`Bad password returned ${badLogin.status}.`)

  adaSocket.close()
  beaSocket.close()
  console.log('Relay smoke test passed.')
} catch (error) {
  console.error(logs)
  console.error(error)
  process.exitCode = 1
} finally {
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(2000).then(() => {
      server.kill('SIGKILL')
    }),
  ])
  if (server.exitCode == null) await new Promise((resolve) => server.once('exit', resolve))
  await rm(dataDir, { recursive: true, force: true })
}

async function waitForHealth() {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {
      await delay(150)
    }
  }
  throw new Error('Server did not become healthy.')
}

async function register(username: string, displayName: string) {
  return send(null, '/api/auth/register', { username, displayName, password: 'correct-horse' })
}

async function send(token: string | null, path: string, body?: unknown, method?: string) {
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method ?? 'POST'} ${path} failed (${response.status}): ${data.error ?? 'unknown error'}`)
  return data
}

function connect(token: string) {
  return new Promise<ReturnType<typeof io>>((resolve, reject) => {
    const socket = io(base, { auth: { token }, transports: ['websocket'] })
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Socket connection timed out.'))
    }, 8000)
    socket.on('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.on('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function waitFor(socket: ReturnType<typeof io>, event: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), 8000)
    socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
