const configuredApiUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5000';

export const API_URL = configuredApiUrl.replace(/\/$/, '');
export const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL ?? API_URL).replace(/\/$/, '');
export const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? '';
