import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function connectSocket(url: string, token: string) {
  disconnectSocket()
  socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
  })
  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
}
