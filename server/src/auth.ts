import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { ensureDataDirectory } from './paths'

const TOKEN_TTL = '30d'

function loadSecret() {
  if (process.env.RELAY_SECRET && process.env.RELAY_SECRET.trim()) {
    return process.env.RELAY_SECRET.trim()
  }
  const file = path.join(ensureDataDirectory(), 'jwt.secret')
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  }
  const secret = randomBytes(32).toString('hex')
  fs.writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

const secret = loadSecret()

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, secret, { expiresIn: TOKEN_TTL })
}

export function userIdFromToken(token: string) {
  try {
    const payload = jwt.verify(token, secret)
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null
    return payload.sub
  } catch {
    return null
  }
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

export function bearerToken(header: string | undefined) {
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token
}
