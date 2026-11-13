import { io } from 'socket.io-client';
import { API_TOKEN, SOCKET_URL } from '../config';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  auth: API_TOKEN ? { token: API_TOKEN } : undefined,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
