const apiUrl = (
  import.meta.env.VITE_API_BASE_URL
  || import.meta.env.VITE_API_URL
  || 'http://127.0.0.1:5000/api'
).replace(/\/$/, '')

export const API_BASE = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`

export async function apiRequest(path, options = {}) {
  const isForm = options.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(import.meta.env.VITE_API_TOKEN ? { Authorization: `Bearer ${import.meta.env.VITE_API_TOKEN}` } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `Request gagal (${response.status})`)
  }

  return response
}

export async function apiJson(path, options) {
  const response = await apiRequest(path, options)
  return response.json()
}
