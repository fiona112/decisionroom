import type { CollectionSchema, ColumnDefinition } from 'deepspace/schema'

const text = (name: string, maxLength = 2000): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain', maxLength })
const denied = { read: false, create: false, update: false, delete: false } as const
const teamRead = { ...denied, read: 'team' } as const
// Even app admins must use the validated command path for business writes.
function collection(name: string, columns: ColumnDefinition[], extra: Partial<CollectionSchema> = {}): CollectionSchema {
  return { name, columns: [text('teamId'), ...columns], teamField: 'teamId',
    permissions: { '*': denied, viewer: denied, member: teamRead, admin: teamRead }, ...extra }
}

export const decisionSchemas: CollectionSchema[] = [
  collection('rooms', [text('title', 120), text('description'), text('hostId'), text('status', 10), text('closedAt')]),
  collection('team_members', [text('userId'), text('status', 10)], { uniqueOn: ['teamId', 'userId'] }),
  collection('invitations', [text('token', 100)], { uniqueOn: ['teamId'] }),
  collection('suggestions', [text('title', 120), text('description'), text('authorId')]),
  collection('votes', [text('userId'), text('suggestionId')], { uniqueOn: ['teamId', 'userId'] }),
  collection('comments', [text('body', 2000), text('authorId')]),
]

export type Room = { teamId: string; title: string; description: string; hostId: string; status: 'open' | 'closed'; closedAt?: string }
export type Suggestion = { teamId: string; title: string; description: string; authorId: string }
export type Vote = { teamId: string; userId: string; suggestionId: string }
export type Comment = { teamId: string; body: string; authorId: string }
