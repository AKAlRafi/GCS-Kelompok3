import { io } from 'socket.io-client'
import { API_BASE } from './api'

const serverUrl = (
  import.meta.env.VITE_SOCKET_URL
  || API_BASE.replace(/\/api\/?$/, '')
).replace(/\/$/, '')
const token = import.meta.env.VITE_API_TOKEN || ''

export const socket = io(serverUrl, {
  autoConnect: false,
  auth: token ? { token } : undefined,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
})
