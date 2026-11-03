export const TOKEN_KEY = 'relay.token'
export const URL_KEY = 'relay.serverUrl'
export const DEFAULT_URL = 'http://127.0.0.1:4000'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_URL
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error('Enter a server address like http://127.0.0.1:4000')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Use an http or https server address.')
  }
  return `${parsed.protocol}//${parsed.host}`
}

export function getToken() {
  const current = sessionStorage.getItem(TOKEN_KEY)
  if (current) return current
  const shared = localStorage.getItem(TOKEN_KEY)
  if (!shared) return null
  sessionStorage.setItem(TOKEN_KEY, shared)
  localStorage.removeItem(TOKEN_KEY)
  return shared
}

export function saveToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(TOKEN_KEY)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

export function getServerUrl() {
  const stored = localStorage.getItem(URL_KEY)
  if (!stored) return DEFAULT_URL
  try {
    return normalizeServerUrl(stored)
  } catch {
    return DEFAULT_URL
  }
}

export function saveServerUrl(url: string) {
  const normalized = normalizeServerUrl(url)
  localStorage.setItem(URL_KEY, normalized)
  return normalized
}

export async function checkHealth(serverUrl: string) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${serverUrl}/api/health`, { signal: controller.signal })
    if (!response.ok) throw new Error('The server did not answer.')
    const data = (await response.json().catch(() => null)) as { name?: string } | null
    if (!data || data.name !== 'relay') throw new Error('That address is not a Relay server.')
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Failed to fetch' || error.message.startsWith("Can't reach"))) {
      throw new Error(`Can't reach ${serverUrl}. Start the Relay server and try again.`)
    }
    if (error instanceof Error) throw error
    throw new Error(`Can't reach ${serverUrl}. Start the Relay server and try again.`)
  } finally {
    window.clearTimeout(timer)
  }
}

export async function api<T>(path: string, options?: { method?: string; body?: unknown; token?: string | null; serverUrl?: string }): Promise<T> {
  const serverUrl = options?.serverUrl ?? getServerUrl()
  const token = options?.token === undefined ? getToken() : options.token
  let response: Response
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options?.method ?? (options?.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(0, `Can't reach ${serverUrl}. Start the Relay server and try again.`)
  }
  const data = (await response.json().catch(() => ({}))) as { error?: unknown }
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`
    if (response.status === 401 && token && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('relay:unauthorized'))
    }
    throw new ApiError(response.status, message)
  }
  return data as T
}
