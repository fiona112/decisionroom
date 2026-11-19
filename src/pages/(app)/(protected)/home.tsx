import { useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { ArrowRight, ArrowUpRight, Check, Plus, Users, Vote } from 'lucide-react'
import { decisionCommand } from '../../../lib/decisions'
import type { Room } from '../../../schemas/decision-schema'
import { RoomView } from '../../../components/decisions/RoomView'
import { RoomForm, QueryNotice } from '../../../components/decisions/shared'

export default function HomePage() {
  const [params, setParams] = useSearchParams()
  const roomId = params.get('room')
  const invite = params.get('invite')
  if (invite) return <Invitation token={invite} onJoin={(id) => setParams({ room: id }, { replace: true })} />
  if (roomId) return <RoomView key={roomId} roomId={roomId} />
  return <Dashboard onOpen={(id) => setParams({ room: id })} />
}

function Invitation({ token, onJoin }: { token: string; onJoin: (id: string) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  async function join() {
    if (locked.current) return
    locked.current = true
    setPending(true); setError('')
    try { onJoin((await decisionCommand({ kind: 'join', token })).roomId) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to join.') }
    finally { setPending(false); locked.current = false }
  }
  return <div className="dr-container dr-invite"><div className="dr-panel">
    <span className="dr-icon"><Users size={28} /></span><p className="dr-eyebrow">YOU’RE INVITED</p>
    <h1>A good decision starts with you.</h1>
    <p>Join this room to explore the options, share your perspective, and cast your vote.</p>
    <p className="dr-note">Room members can see your suggestions, vote, and comments. Anyone with this invitation can join.</p>
    {error && <p className="dr-error" role="alert">{error}</p>}
    <button className="dr-button" disabled={pending} onClick={() => void join()}>{pending ? 'Joining…' : 'Join room'}<ArrowRight size={16} /></button>
    <Link className="dr-text-link" to="/home">Back to my rooms</Link>
  </div></div>
}

function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const { userId } = useAuth()
  const query = useQuery<Room>('rooms', { orderBy: 'createdAt', orderDir: 'desc', limit: 500 })
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const rooms = query.records.filter(r => (filter === 'all' || r.data.status === filter) && r.data.title.toLowerCase().includes(search.toLowerCase()))
  return <div className="dr-container">
    <header className="dr-page-header"><div><p className="dr-eyebrow">A LITTLE CLARITY, TOGETHER</p><h1>Your decision rooms</h1><p>Less back-and-forth. More moving forward.</p></div>
      <button className="dr-button" onClick={() => setShowForm(!showForm)} aria-expanded={showForm}><Plus size={18} />New room</button>
    </header>
    {showForm && <section className="dr-panel dr-create"><h2>What are we deciding?</h2><RoomForm kind="createRoom" onSaved={onOpen} onCancel={() => setShowForm(false)} /></section>}
    <section className="dr-overview" aria-label="Room overview"><div><span className="dr-icon"><Vote size={21} /></span><div><strong>{query.records.filter(r => r.data.status === 'open').length}</strong><span>Open decisions</span></div></div><div><span className="dr-icon"><Check size={21} /></span><div><strong>{query.records.filter(r => r.data.status === 'closed').length}</strong><span>Decisions closed</span></div></div><p>One person, one vote.<br /><span>Everyone gets a voice.</span></p></section>
    <div className="dr-toolbar"><div className="dr-filters" aria-label="Filter rooms">{['all', 'open', 'closed'].map(f => <button key={f} aria-pressed={f === filter} onClick={() => setFilter(f)}>{f === 'all' ? 'All rooms' : f === 'open' ? 'Open' : 'Closed'}</button>)}</div><input className="dr-search" type="search" aria-label="Search rooms" placeholder="Find a room…" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <QueryNotice status={query.status} error={query.error} />
    {query.status === 'ready' && !rooms.length && <section className="dr-empty dr-panel"><span className="dr-icon"><Users size={28} /></span><h2>{query.records.length ? 'No matching rooms' : 'Make space for your next decision.'}</h2><p>{query.records.length ? 'Try another search or filter.' : 'Create a room, invite your people, and put the options on the table.'}</p>{!query.records.length && <button className="dr-button" onClick={() => setShowForm(true)}><Plus size={16} />Create your first room</button>}</section>}
    <div className="dr-room-grid">{rooms.map(room => <Link className="dr-room-card" key={room.recordId} to={`/home?room=${encodeURIComponent(room.recordId)}`}>
      <div className="dr-row"><span className={`dr-badge ${room.data.status === 'closed' ? 'is-closed' : ''}`}><span />{room.data.status === 'open' ? 'Voting open' : 'Closed'}</span><ArrowUpRight size={18} /></div>
      <h2>{room.data.title}</h2><p>{room.data.description || 'A shared space to find the best way forward.'}</p><div className="dr-card-footer"><span>{room.data.hostId === userId ? 'Hosted by you' : 'Joined room'}</span><span>{new Date(room.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
    </Link>)}</div>
    {query.records.length === 500 && <p className="dr-note">Showing the 500 most recent rooms.</p>}
  </div>
}
