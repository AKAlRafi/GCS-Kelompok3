import { io } from 'socket.io-client'

const serverUrl = (
  import.meta.env.VITE_SOCKET_URL
  || import.meta.env.VITE_API_URL
  || import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/?$/, '')
  || 'http://127.0.0.1:5000'
).replace(/\/$/, '')
const token = import.meta.env.VITE_API_TOKEN || ''

export const socket = io(serverUrl, {
  autoConnect: false,
  auth: token ? { token } : undefined,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
})
