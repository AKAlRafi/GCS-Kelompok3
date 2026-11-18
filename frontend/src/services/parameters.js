const base = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')
const token = import.meta.env.VITE_API_TOKEN || ''

export async function fetchParameters() {
    const res = await fetch(`${base}/api/parameters`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = Array.isArray(data) ? data : data.parameters ?? []
    // Field names are a guess: adjust after checking one real response
    return list.map((p) => ({
        id: String(p.name ?? p.param_id ?? p.key ?? p.id ?? ''),
        value: p.value ?? p.param_value ?? null,
        type: p.type ?? p.param_type ?? null,
    }))
}

export async function downloadParametersFromVehicle() {
  const res = await fetch(`${base}/api/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ type: 'download_params', payload: {} }),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
  return (data.parameters ?? []).map((p) => ({ id: p.id, value: p.value, type: p.type }))
}