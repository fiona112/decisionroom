import { getAuthToken } from 'deepspace'

export async function decisionCommand(params: Record<string, unknown>): Promise<{ roomId: string }> {
  const token = await getAuthToken()
  if (!token) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch('/api/actions/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const result = await response.json() as { success?: boolean; data?: { roomId: string }; error?: string }
  if (!response.ok || !result.success || !result.data) throw new Error(result.error || 'Could not save. Please try again.')
  return result.data
}
