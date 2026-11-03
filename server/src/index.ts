import http from 'node:http'
import os from 'node:os'
import cors from 'cors'
import express from 'express'
import { closeDatabase, databaseFile } from './db'
import { createRouter } from './routes'
import { attachRealtime } from './realtime'

const port = Number(process.env.PORT || 4000)
const host = process.env.HOST || '0.0.0.0'

const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: true }))
app.use(express.json({ limit: '200kb' }))
app.use('/api', createRouter())

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error)
    return
  }
  console.error(error)
  res.status(500).json({ error: 'Something went wrong.' })
})

const server = http.createServer(app)
attachRealtime(server)

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or set PORT to a free port.`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})

server.listen(port, host, () => {
  const networks = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === 'IPv4' && !entry.internal))
    .map((entry) => `http://${entry.address}:${port}`)
  console.log('Relay server is ready')
  console.log(`  This computer: http://127.0.0.1:${port}`)
  for (const address of networks) console.log(`  On your network: ${address}`)
  console.log(`  Saved data: ${databaseFile()}`)
})

function shutdown() {
  server.close(() => {
    closeDatabase()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
