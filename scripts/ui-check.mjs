import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const WebSocket = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/node_modules/ws'))

const port = 9333
const profile = '/tmp/relay-ui-chrome'
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.ui-check')
await rm(profile, { recursive: true, force: true })
await mkdir(shots, { recursive: true })

const chrome = spawn('google-chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })

try {
  const target = await waitForTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
      else resolve(message.result)
    })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw new Error(details.exception?.description || details.text || JSON.stringify(details))
    }
    return result.result?.value
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await waitFor(async () => (await evaluate(`document.querySelector('.auth-card h2')?.textContent || ''`)) === 'Create an account')

  const username = `casey${Date.now().toString(36)}`
  const friend = `drew${Date.now().toString(36)}`
  await evaluate(`(() => {
    const set = (label, value) => {
      const field = [...document.querySelectorAll('label')].find((item) => item.innerText.startsWith(label)).querySelector('input, textarea')
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('Display name', 'Casey')
    set('Username', ${JSON.stringify(username)})
    set('Password', 'correct-horse')
    document.querySelector('.auth-card button.primary').click()
  })()`)
  await waitFor(async () => Boolean(await evaluate(`document.body.innerText.includes('Direct Messages')`)))
  await shot(send, shots, 'home.png')

  await evaluate(`document.querySelector('.server-btn.add').click()`)
  await delay(100)
  await evaluate(`[...document.querySelectorAll('.rail-menu button')].find((button) => button.textContent.includes('Create')).click()`)
  await waitFor(async () => (await evaluate(`document.querySelector('.modal h3')?.textContent || ''`)) === 'Create a server')
  await evaluate(`(() => {
    const field = document.querySelector('.modal input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Launch')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.modal button.primary').click()
  })()`)
  await waitFor(async () => (await evaluate(`document.querySelector('.modal h3')?.textContent || ''`)) === 'Invite people')
  const invite = await evaluate(`document.querySelector('.modal input').value`)
  await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent === 'Close').click()`)
  await waitFor(async () => Boolean(await evaluate(`document.body.innerText.includes('# general') || document.body.innerText.includes('general')`)))

  await evaluate(`(() => {
    const field = document.querySelector('#composer')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Hello from Casey')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.composer button.primary').click()
  })()`)
  await waitFor(async () => Boolean(await evaluate(`document.body.innerText.includes('Hello from Casey')`)))

  const live = await evaluate(`(async () => {
    const token = localStorage.getItem('relay.token')
    const registered = await fetch('http://127.0.0.1:4000/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ${JSON.stringify(friend)}, displayName: 'Drew', password: 'correct-horse' }),
    }).then((response) => response.json())
    const joined = await fetch('http://127.0.0.1:4000/api/invites/' + ${JSON.stringify(invite)} + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + registered.token },
      body: '{}',
    }).then((response) => response.json())
    const channelId = joined.server.channels[0].id
    const posted = await fetch('http://127.0.0.1:4000/api/channels/' + channelId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + registered.token },
      body: JSON.stringify({ content: 'Hello from Drew' }),
    })
    return posted.ok ? 'sent' : 'failed ' + posted.status
  })()`)
  if (live !== 'sent') throw new Error(`Friend message was not accepted (${live}).`)
  await waitFor(async () => Boolean(await evaluate(`document.body.innerText.includes('Hello from Drew') && document.body.innerText.includes('Drew')`)))
  await shot(send, shots, 'chat.png')
  const text = await evaluate(`document.body.innerText`)
  const rendered = text.toLowerCase()
  if (!rendered.includes('launch') || !rendered.includes('online') || !rendered.includes('hello from drew')) {
    throw new Error('The server shell did not render the live conversation.')
  }
  console.log('UI check passed.')
  ws.close()
} finally {
  chrome.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
}

async function shot(send, directory, name) {
  const image = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(directory, name), Buffer.from(image.data, 'base64'))
}

async function waitForTarget() {
  const started = Date.now()
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      await delay(150)
    }
  }
  throw new Error('Chrome did not open a debugging port.')
}

async function waitFor(check) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < 10000) {
    try {
      if (await check()) return
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await delay(150)
  }
  throw new Error(last || 'Timed out waiting for the page.')
}
