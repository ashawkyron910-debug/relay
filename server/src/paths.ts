import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function dataDirectory() {
  return process.env.RELAY_DATA_DIR
    ? path.resolve(process.env.RELAY_DATA_DIR)
    : path.join(serverRoot, 'data')
}

export function ensureDataDirectory() {
  const dir = dataDirectory()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
