import { apiJson } from './api'

export async function downloadParametersFromVehicle() {
  const result = await apiJson('/commands', {
    method: 'POST',
    body: JSON.stringify({ type: 'download_params' }),
  })
  return result.parameters || []
}
