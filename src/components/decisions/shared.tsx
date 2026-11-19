import { useRef, useState, type FormEvent } from 'react'
import { decisionCommand } from '../../lib/decisions'
import { useNetworkOnline } from '../../lib/use-network-online'

export function QueryNotice({ status, error }: { status: string; error?: string }) {
  if (status === 'ready') return null
  return <div className={status === 'error' ? 'dr-error' : 'dr-note'} role={status === 'error' ? 'alert' : 'status'}>{status === 'error' ? <>{error || 'Connection interrupted.'} <button className="dr-text-link" onClick={() => window.location.reload()}>Reconnect</button></> : 'Connecting to your room…'}</div>
}

export function RoomForm({ kind, roomId, onSaved, onCancel }: { kind: 'createRoom' | 'suggest'; roomId?: string; onSaved: (id: string) => void; onCancel: () => void }) {
  const online = useNetworkOnline()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setPending(true); setError('')
    try {
      const result = await decisionCommand({ kind, roomId, title, description })
      onSaved(result.roomId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setPending(false); lock.current = false }
  }
  return <form className="dr-form" onSubmit={submit}>
    <label>{kind === 'createRoom' ? 'Room title' : 'Option title'}<input autoFocus required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === 'createRoom' ? 'Where should we hold our team offsite?' : 'What do you suggest?'} /></label>
    <label>{kind === 'createRoom' ? 'Context' : 'Why this option?'} <span className="dr-optional">optional</span><textarea maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="A little context helps everyone decide." /></label>
    {error && <p className="dr-error" role="alert">{error}</p>}
    {!online && <p className="dr-error" role="status">You’re offline. Your draft is kept here until you reconnect.</p>}
    <div className="dr-actions"><button className="dr-button" disabled={!online || pending || !title.trim()}>{pending ? 'Saving…' : kind === 'createRoom' ? 'Create room' : 'Add option'}</button><button className="dr-button secondary" type="button" onClick={onCancel} disabled={pending}>Cancel</button></div>
  </form>
}
