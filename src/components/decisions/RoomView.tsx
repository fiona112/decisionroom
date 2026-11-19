import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useQuery, useRecordContext, useUserLookup } from 'deepspace'
import { ArrowLeft, Check, Copy, LockKeyhole, MessageSquare, Plus, Users, Vote as VoteIcon } from 'lucide-react'
import type { Room, Suggestion, Vote, Comment } from '../../schemas/decision-schema'
import { decisionCommand } from '../../lib/decisions'
import { useNetworkOnline } from '../../lib/use-network-online'
import { QueryNotice, RoomForm } from './shared'

export function RoomView({ roomId }: { roomId: string }) {
  const { userId } = useAuth()
  const connection = useRecordContext()
  const online = useNetworkOnline()
  const { getName } = useUserLookup()
  const roomQuery = useQuery<Room>('rooms', { where: { recordId: roomId }, limit: 1 })
  const options = useQuery<Suggestion>('suggestions', { where: { teamId: roomId }, orderBy: 'createdAt', orderDir: 'asc', limit: 100 })
  const votes = useQuery<Vote>('votes', { where: { teamId: roomId }, limit: 200 })
  const members = useQuery<{ userId: string }>('team_members', { where: { teamId: roomId }, limit: 200 })
  const invites = useQuery<{ token: string }>('invitations', { where: { teamId: roomId }, limit: 1 })
  const [adding, setAdding] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyFallback, setCopyFallback] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const room = roomQuery.records[0]
  const ownVote = votes.records.find(v => v.data.userId === userId)?.data.suggestionId
  const closed = room?.data.status === 'closed'
  const ready = online && connection.ready && connection.status === 'connected' && [roomQuery, options, votes, members].every(q => q.status === 'ready')
  const tally = new Map<string, number>()
  for (const v of votes.records) tally.set(v.data.suggestionId, (tally.get(v.data.suggestionId) || 0) + 1)
  const highest = Math.max(0, ...tally.values())
  const leaders = options.records.filter(o => highest > 0 && tally.get(o.recordId) === highest)
  async function run(kind: 'vote' | 'close', suggestionId?: string) {
    if (lock.current) return
    lock.current = true; setPending(suggestionId || kind); setError(''); setNotice('')
    try {
      await decisionCommand({ kind, roomId, suggestionId })
      setConfirmClose(false)
      setNotice(kind === 'close' ? 'Voting closed. Results are final.' : 'Your vote is saved. You can change it while voting is open.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setPending(''); lock.current = false }
  }
  async function copyInvite() {
    const token = invites.records[0]?.data.token
    if (!token) return
    const url = new URL('/home', window.location.origin)
    url.searchParams.set('invite', token)
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true) }
    catch { setCopyFallback(url.toString()) }
  }
  if (roomQuery.status !== 'ready' && !room) return <div className="dr-container"><QueryNotice status={roomQuery.status} error={roomQuery.error} /></div>
  if (!room) return <div className="dr-container dr-empty"><h1>This room isn’t available.</h1><p>Ask a room member for an invitation link to join.</p><Link className="dr-button" to="/home">Back to my rooms</Link></div>
  return <div className="dr-container">
    <Link to="/home" className="dr-back"><ArrowLeft size={16} />All rooms</Link>
    <header className="dr-page-header dr-room-header"><div><div className="dr-row dr-heading-meta"><span className={`dr-badge ${closed ? 'is-closed' : ''}`}><span />{closed ? 'Voting closed' : 'Voting open'}</span><span className="dr-note">Hosted by {room.data.hostId === userId ? 'you' : getName(room.data.hostId) || 'a room member'}</span></div><h1>{room.data.title}</h1><p className="dr-description">{room.data.description || 'Explore the options and help the group choose.'}</p></div>
      <button className="dr-button secondary" onClick={() => void copyInvite()} disabled={invites.status !== 'ready' || !invites.records.length}><Copy size={16} />{copied ? 'Link copied' : 'Invite people'}</button>
    </header>
    {copyFallback && <label className="dr-copy">Copy this invitation link<input readOnly value={copyFallback} onFocus={e => e.target.select()} /></label>}
    {invites.status === 'error' && <QueryNotice status={invites.status} error={invites.error} />}
    <div className="dr-room-summary"><span><Users size={17} />{members.records.length} members</span><span><VoteIcon size={17} />{votes.records.length} votes cast</span><span className="dr-live"><span />{ready ? (closed ? 'Final results' : 'Live results') : 'Connecting…'}</span></div>
    {error && <p className="dr-error" role="alert">{error}</p>}{notice && <p className="dr-success" role="status">{notice}</p>}
    {(!online || connection.status !== 'connected') && <p className="dr-error" role="status">Connection lost. Reconnecting… Your view may be out of date.</p>}
    {[options, votes, members].some(q => q.status === 'error') && <QueryNotice status="error" error="Results may be out of date. Reconnect before voting." />}
    {closed && ready && <section className="dr-outcome"><span className="dr-icon"><Check size={24} /></span><div><p className="dr-eyebrow">THE ROOM HAS DECIDED</p><h2>{leaders.length === 0 ? 'Closed without any votes' : leaders.length > 1 ? `It’s a tie between ${leaders.length} options` : leaders[0].data.title}</h2><p>{leaders.length > 1 ? leaders.map(l => l.data.title).join(' · ') : leaders.length ? `${highest} of ${votes.records.length} votes. Thanks for adding your voice.` : 'The discussion can still continue below.'}</p></div></section>}
    <div className="dr-workspace"><section className="dr-options"><div className="dr-section-header"><div><p className="dr-eyebrow">PUT IT ON THE TABLE</p><h2>Options <span className="dr-count">{options.records.length}</span></h2></div>{!closed && <button className="dr-button secondary small" disabled={!ready} onClick={() => setAdding(!adding)} aria-expanded={adding}><Plus size={16} />Add option</button>}</div>
      <p className="dr-note dr-vote-note">{closed ? 'Voting is closed. These results are final.' : ownVote ? 'Your vote is in. Select another option to change it.' : 'Choose one option. You can change your vote until the host closes voting.'}</p>
      {adding && !closed && <div className="dr-panel dr-option-form"><h3>Add an option</h3><RoomForm kind="suggest" roomId={roomId} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} /></div>}
      {options.status !== 'ready' && <QueryNotice status={options.status} error={options.error} />}
      {options.status === 'ready' && !options.records.length && <div className="dr-panel dr-empty"><VoteIcon size={30} /><h3>No options on the table yet.</h3><p>{closed ? 'This room was closed before suggestions were added.' : 'Be the first to suggest a way forward.'}</p></div>}
      {options.records.map((option, index) => {
        const count = tally.get(option.recordId) || 0
        const percent = votes.records.length ? Math.round(count / votes.records.length * 100) : 0
        const selected = ownVote === option.recordId
        return <article className={`dr-option ${selected ? 'selected' : ''}`} key={option.recordId} data-testid="option-card"><div className="dr-option-top"><span className="dr-option-number">{String(index + 1).padStart(2, '0')}</span><div className="dr-option-content"><h3>{option.data.title}</h3>{option.data.description && <p>{option.data.description}</p>}<span className="dr-note">Suggested by {option.data.authorId === userId ? 'you' : getName(option.data.authorId) || 'a room member'}</span></div></div>
          <div className="dr-result"><div className="dr-row"><span>{count} {count === 1 ? 'vote' : 'votes'}{closed && highest > 0 && count === highest ? ' · Top choice' : ''}</span><strong>{percent}%</strong></div><div className="dr-progress" role="progressbar" aria-label={`Votes for ${option.data.title}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div></div>
          <button className={`dr-vote ${selected ? 'chosen' : ''}`} disabled={closed || !!pending || !ready || selected} aria-pressed={selected} onClick={() => void run('vote', option.recordId)}>{pending === option.recordId ? 'Saving vote…' : selected ? <><Check size={16} />Your vote</> : closed ? 'Voting closed' : 'Vote for this option'}</button>
        </article>
      })}
      {!closed && room.data.hostId === userId && <section className="dr-host"><LockKeyhole size={18} /><div><h3>Ready to call it?</h3><p>Close voting to make these results final.</p>{confirmClose ? <div className="dr-close-confirm"><p>Everyone’s votes will be locked. You can’t reopen this room.</p><div className="dr-actions"><button className="dr-button" disabled={!!pending || !ready} onClick={() => void run('close')}>{pending === 'close' ? 'Closing…' : 'Confirm close'}</button><button className="dr-button secondary" disabled={!!pending} onClick={() => setConfirmClose(false)}>Keep voting open</button></div></div> : <button className="dr-text-link" onClick={() => setConfirmClose(true)}>Close voting</button>}</div></section>}
    </section><Discussion roomId={roomId} /></div>
  </div>
}

function Discussion({ roomId }: { roomId: string }) {
  const online = useNetworkOnline()
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const query = useQuery<Comment>('comments', { where: { teamId: roomId }, orderBy: 'createdAt', orderDir: 'desc', limit: 100 })
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setPending(true); setError('')
    try { await decisionCommand({ kind: 'comment', roomId, body }); setBody('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send.') }
    finally { setPending(false); lock.current = false }
  }
  return <aside className="dr-discussion dr-panel"><div className="dr-section-header"><h2><MessageSquare size={18} />Discussion</h2><span className="dr-count">{query.records.length}{query.records.length === 100 ? '+' : ''}</span></div><p className="dr-note">The thinking behind the votes.</p>
    <QueryNotice status={query.status} error={query.error} />
    <div className="dr-messages" role="log" aria-label="Room discussion" aria-live="polite">{query.status === 'ready' && !query.records.length && <div className="dr-chat-empty"><MessageSquare size={25} /><p>Have a thought? Start the conversation.</p></div>}{query.records.length === 100 && <p className="dr-note">Showing the latest 100 comments.</p>}{[...query.records].reverse().map(comment => {
      const name = comment.data.authorId === userId ? 'You' : getName(comment.data.authorId) || 'Room member'
      return <article className="dr-message" key={comment.recordId}><span className="dr-avatar" aria-hidden>{name[0].toUpperCase()}</span><div><div className="dr-message-meta"><strong>{name}</strong><time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{new Date(comment.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></div><p>{comment.data.body}</p></div></article>
    })}</div>
    <form className="dr-form dr-message-form" onSubmit={submit}><label className="sr-only" htmlFor="comment">Your comment</label><textarea id="comment" placeholder="Add to the discussion…" rows={3} maxLength={2000} required value={body} onChange={e => setBody(e.target.value)} />{error && <p className="dr-error" role="alert">{error}</p>}<div className="dr-row"><span className="dr-note">Be thoughtful. Be kind.</span><button className="dr-button small" disabled={!online || pending || !body.trim() || query.status !== 'ready'}>{pending ? 'Sending…' : 'Send'}</button></div></form>
  </aside>
}
