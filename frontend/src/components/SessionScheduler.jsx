import { CalendarPlus, Copy, Mail, RefreshCw, Search, Send, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const emptyForm = {
  candidateId: '',
  candidateName: '',
  candidateEmail: '',
  companyName: '',
  position: '',
  startTime: '',
  endTime: '',
  duration: 60,
  skills: '',
  experienceLevel: 'intermediate',
  focusAreas: 'technical,problem-solving',
  allowCodeEditor: true,
  customQuestions: '',
  notes: ''
}

const statusOptions = ['all', 'scheduled', 'active', 'completed', 'expired', 'cancelled']

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function statusClass(status) {
  const styles = {
    scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    completed: 'bg-slate-100 text-slate-700 border-slate-200',
    expired: 'bg-amber-50 text-amber-700 border-amber-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200'
  }
  return styles[status] || 'bg-slate-100 text-slate-600 border-slate-200'
}

export default function SessionScheduler() {
  const { apiFetch, user } = useAuth()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [actionId, setActionId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [formData, setFormData] = useState(emptyForm)
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      setError('')
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const suffix = params.toString() ? `?${params}` : ''
      const data = await apiFetch(`/api/scheduled-sessions/list${suffix}`)
      setSessions(data.sessions || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingSessions(false)
    }
  }, [apiFetch, statusFilter])

  useEffect(() => { loadSessions() }, [loadSessions])

  const visibleSessions = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return sessions
    return sessions.filter(session => [
      session.candidateName,
      session.candidateId,
      session.candidateEmail,
      session.position,
      session.sessionId
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(search)))
  }, [sessions, query])

  const handleInputChange = event => {
    const { name, value, type, checked } = event.target
    setFormData(previous => ({ ...previous, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = async event => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    setInviteUrl('')

    try {
      const sessionData = {
        ...formData,
        duration: Number(formData.duration) || 60,
        skills: formData.skills.split(',').map(value => value.trim()).filter(Boolean),
        focusAreas: formData.focusAreas.split(',').map(value => value.trim()).filter(Boolean),
        customQuestions: formData.customQuestions.split('\n').map(value => value.trim()).filter(Boolean),
        accessWindow: { beforeStart: 15, afterEnd: 15 },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      }

      const data = await apiFetch('/api/scheduled-sessions/create', {
        method: 'POST',
        body: JSON.stringify(sessionData)
      })

      setSuccess(`Interview scheduled for ${data.session.candidateName}. The secure link below is shown only now.`)
      setInviteUrl(data.session.accessUrl || '')
      setFormData(emptyForm)
      await loadSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyInvite = async url => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setSuccess('Secure interview link copied to clipboard.')
    } catch {
      setError('Could not copy automatically. Select and copy the link manually.')
    }
  }

  const sendInvite = async session => {
    setActionId(`invite:${session.sessionId}`)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch('/api/email/send-session-invite', {
        method: 'POST',
        body: JSON.stringify({ candidateId: session.candidateId, sessionId: session.sessionId })
      })
      const secureUrl = data.data?.sessionUrl || ''
      setInviteUrl(secureUrl)
      setSuccess(`Fresh secure invite sent to ${data.data?.candidateEmail || session.candidateEmail}. Any older invite link is now invalid.`)
      await loadSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionId('')
    }
  }

  const sendReminder = async session => {
    setActionId(`reminder:${session.sessionId}`)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch('/api/email/send-reminder', {
        method: 'POST',
        body: JSON.stringify({ candidateId: session.candidateId, sessionId: session.sessionId, minutesUntilStart: 15 })
      })
      setInviteUrl(data.data?.sessionUrl || '')
      setSuccess(`Reminder sent to ${data.data?.candidateEmail || session.candidateEmail}; the interview token was rotated for security.`)
      await loadSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionId('')
    }
  }

  const cancelSession = async session => {
    if (!window.confirm(`Cancel the interview for ${session.candidateName}?`)) return
    setActionId(`cancel:${session.sessionId}`)
    setError('')
    try {
      await apiFetch(`/api/scheduled-sessions/update/${encodeURIComponent(session.sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' })
      })
      setSuccess(`Interview for ${session.candidateName} was cancelled.`)
      await loadSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setActionId('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600">Interview operations</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Interviews</h1>
          <p className="mt-2 text-sm text-slate-500">Schedule secure sessions, send rotating invite links, and manage live interview status.</p>
        </div>
        <button onClick={loadSessions} disabled={loadingSessions} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={loadingSessions ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      {inviteUrl && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div><p className="font-semibold text-blue-950">Current secure candidate link</p><p className="mt-1 text-xs text-blue-700">Treat this as a password. Resending an invite rotates the token and invalidates the previous link.</p></div>
            <button onClick={() => copyInvite(inviteUrl)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"><Copy size={15} /> Copy link</button>
          </div>
          <input readOnly value={inviteUrl} className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-slate-600" />
        </div>
      )}

      <div className="grid xl:grid-cols-[0.8fr_1.2fr] gap-6 items-start">
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 xl:sticky xl:top-24">
          <div className="flex items-center gap-2"><CalendarPlus size={19} className="text-blue-600" /><div><h2 className="font-semibold text-slate-900">Schedule interview</h2><p className="text-xs text-slate-500">Signed in as {user?.name}</p></div></div>

          <div className="grid sm:grid-cols-2 gap-3">
            <input required name="candidateId" value={formData.candidateId} onChange={handleInputChange} placeholder="Candidate ID" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            <input required name="candidateName" value={formData.candidateName} onChange={handleInputChange} placeholder="Candidate name" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            <input type="email" name="candidateEmail" value={formData.candidateEmail} onChange={handleInputChange} placeholder="Candidate email" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            <input name="companyName" value={formData.companyName} onChange={handleInputChange} placeholder="Company" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          </div>

          <input name="position" value={formData.position} onChange={handleInputChange} placeholder="Position / role" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">Start time<input required type="datetime-local" name="startTime" value={formData.startTime} onChange={handleInputChange} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-600">End time<input required type="datetime-local" name="endTime" value={formData.endTime} onChange={handleInputChange} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">Duration<input type="number" min="15" max="240" name="duration" value={formData.duration} onChange={handleInputChange} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>
            <label className="text-xs font-medium text-slate-600">Level<select name="experienceLevel" value={formData.experienceLevel} onChange={handleInputChange} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="junior">Junior</option><option value="intermediate">Intermediate</option><option value="senior">Senior</option></select></label>
          </div>

          <input name="skills" value={formData.skills} onChange={handleInputChange} placeholder="Skills: React, Node.js, C++" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          <input name="focusAreas" value={formData.focusAreas} onChange={handleInputChange} placeholder="Focus areas" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          <textarea name="customQuestions" value={formData.customQuestions} onChange={handleInputChange} rows="3" placeholder="Optional custom questions, one per line" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" placeholder="Internal recruiter notes" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="allowCodeEditor" checked={formData.allowCodeEditor} onChange={handleInputChange} /> Enable coding exercise</label>

          <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{loading ? 'Scheduling…' : 'Schedule secure interview'}</button>
        </form>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search candidate, email, role, session…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{statusOptions.map(status => <option key={status} value={status}>{status === 'all' ? 'All statuses' : status}</option>)}</select>
          </div>

          <div className="divide-y divide-slate-100">
            {visibleSessions.map(session => {
              const canAct = ['scheduled', 'active'].includes(session.status)
              const hasEmail = Boolean(session.candidateEmail)
              return (
                <article key={session.sessionId} className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold text-slate-900 truncate">{session.candidateName}</p><p className="mt-0.5 text-sm text-slate-500 truncate">{session.position || session.role || 'Interview'} · {session.candidateEmail || session.candidateId}</p></div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(session.status)}`}>{session.status}</span>
                  </div>

                  <div className="mt-4 grid sm:grid-cols-2 gap-2 text-xs text-slate-500">
                    <p><span className="text-slate-400">Start:</span> {formatDateTime(session.startTime)}</p>
                    <p><span className="text-slate-400">End:</span> {formatDateTime(session.endTime)}</p>
                    <p className="truncate"><span className="text-slate-400">Session:</span> {session.sessionId}</p>
                    <p><span className="text-slate-400">Failed access:</span> {session.accessAttempts || 0}</p>
                  </div>

                  {canAct && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button disabled={!hasEmail || Boolean(actionId)} onClick={() => sendInvite(session)} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40" title={!hasEmail ? 'Add a candidate email before sending' : 'Rotate token and send fresh invite'}><Mail size={14} /> {actionId === `invite:${session.sessionId}` ? 'Sending…' : 'Send invite'}</button>
                      <button disabled={!hasEmail || Boolean(actionId)} onClick={() => sendReminder(session)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Send size={14} /> {actionId === `reminder:${session.sessionId}` ? 'Sending…' : 'Send reminder'}</button>
                      <button disabled={Boolean(actionId)} onClick={() => cancelSession(session)} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"><XCircle size={14} /> {actionId === `cancel:${session.sessionId}` ? 'Cancelling…' : 'Cancel'}</button>
                    </div>
                  )}
                </article>
              )
            })}
            {!loadingSessions && !visibleSessions.length && <p className="py-14 text-center text-sm text-slate-500">No interviews match the current filters.</p>}
            {loadingSessions && <p className="py-14 text-center text-sm text-slate-500">Loading interviews…</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
