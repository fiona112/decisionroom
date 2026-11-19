import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

export const actions: Record<string, ActionHandler<Env>> = {
  decision: async ({ userId, params, env }) => {
    const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
    const response = await stub.fetch(new Request('https://internal/decision-command', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
      body: JSON.stringify(params),
    }))
    return response.json()
  },
}
