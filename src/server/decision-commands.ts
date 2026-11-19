import { z } from 'zod'
import type { ActionTools, ActionResult } from 'deepspace/worker'

export type RecordTools = Pick<ActionTools, 'get' | 'query' | 'create' | 'update' | 'remove'>
const id = z.string().min(1).max(200)
const title = z.string().trim().min(1, 'Please enter a title.').max(120)
const description = z.string().trim().max(2000).default('')
const commands = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('createRoom'), title, description }),
  z.object({ kind: z.literal('join'), token: z.string().uuid() }),
  z.object({ kind: z.literal('suggest'), roomId: id, title, description }),
  z.object({ kind: z.literal('vote'), roomId: id, suggestionId: id }),
  z.object({ kind: z.literal('comment'), roomId: id, body: z.string().trim().min(1).max(2000) }),
  z.object({ kind: z.literal('close'), roomId: id }),
])
function value<T>(result: ActionResult<T>): T {
  if (!result.success) throw new Error(result.error)
  return result.data
}

/** Called only inside the app RecordRoom's serialized command boundary.
 * Identity comes from the worker's verified session, never the request body.
 * Browser/agent record writes are denied by schema permissions.
 */
export async function runDecisionCommand(userId: string, input: unknown, tools: RecordTools): Promise<ActionResult> {
  if (!userId || userId.startsWith('anon-')) return { success: false, error: 'Sign in to continue.' }
  const parsed = commands.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const p = parsed.data
  try {
    if (p.kind === 'createRoom') {
      const roomId = crypto.randomUUID()
      value(await tools.create('rooms', { teamId: roomId, title: p.title, description: p.description, hostId: userId, status: 'open' }, roomId))
      try {
        value(await tools.create('invitations', { teamId: roomId, token: crypto.randomUUID() }, roomId))
        value(await tools.create('team_members', { teamId: roomId, userId, status: 'active' }))
      } catch (error) {
        await tools.remove('invitations', roomId)
        await tools.remove('rooms', roomId)
        throw error
      }
      return { success: true, data: { roomId } }
    }
    if (p.kind === 'join') {
      const invites = value(await tools.query('invitations', { where: { token: p.token }, limit: 1 })).records
      if (!invites.length) throw new Error('This invitation is invalid. Ask the host for a new link.')
      const roomId = String(invites[0].data.teamId)
      value(await tools.get('rooms', roomId))
      const members = value(await tools.query('team_members', { where: { teamId: roomId, userId }, limit: 1 })).records
      if (!members.length) {
        const roster = value(await tools.query('team_members', { where: { teamId: roomId }, limit: 100 })).records
        if (roster.length >= 100) throw new Error('This room has reached its 100-member limit.')
        value(await tools.create('team_members', { teamId: roomId, userId, status: 'active' }))
      }
      return { success: true, data: { roomId } }
    }
    const members = value(await tools.query('team_members', { where: { teamId: p.roomId, userId, status: 'active' }, limit: 1 })).records
    if (!members.length) throw new Error('Join this room through its invitation link first.')
    const room = value(await tools.get('rooms', p.roomId)).record
    if (p.kind === 'close') {
      if (room.data.hostId !== userId) throw new Error('Only the room host can close voting.')
      if (room.data.status !== 'closed') value(await tools.update('rooms', p.roomId, { status: 'closed', closedAt: new Date().toISOString() }))
    } else if (p.kind === 'comment') {
      value(await tools.create('comments', { teamId: p.roomId, body: p.body, authorId: userId }))
    } else {
      if (room.data.status !== 'open') throw new Error('Voting is closed. The results are final.')
      if (p.kind === 'suggest') {
        const options = value(await tools.query('suggestions', { where: { teamId: p.roomId }, limit: 50 })).records
        if (options.length >= 50) throw new Error('This room has reached its 50-option limit.')
        value(await tools.create('suggestions', { teamId: p.roomId, title: p.title, description: p.description, authorId: userId }))
      } else {
        const suggestion = value(await tools.get('suggestions', p.suggestionId)).record
        if (suggestion.data.teamId !== p.roomId) throw new Error('That suggestion does not belong to this room.')
        const votes = value(await tools.query('votes', { where: { teamId: p.roomId, userId }, limit: 1 })).records
        if (votes.length) value(await tools.update('votes', votes[0].recordId, { suggestionId: p.suggestionId }))
        else value(await tools.create('votes', { teamId: p.roomId, userId, suggestionId: p.suggestionId }))
      }
    }
    return { success: true, data: { roomId: p.roomId } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Could not save. Please try again.' }
  }
}
