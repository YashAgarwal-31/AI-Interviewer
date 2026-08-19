import { useEffect, useState } from 'react'
import config from '../config'

const ADMIN_KEY_STORAGE = 'ai_interviewer_admin_key'

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

const SessionScheduler = () => {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(ADMIN_KEY_STORAGE) || '')
  const [keyInput, setKeyInput] = useState('')
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [formData, setFormData] = useState(emptyForm)

  const adminFetch = async (path, options = {}) => {
    const headers = new Headers(options.headers || {})
    headers.set('X-Admin-Key', adminKey)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    const response = await fetch(`${config.AI_BACKEND_URL}${path}`, { ...options, headers })
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }))
    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem(ADMIN_KEY_STORAGE)
      }
      throw new Error(data.error || data.message || `Request failed (${response.status})`)
    }
    return data
  }

  const loadSessions = async () => {
    if (!adminKey) return
    try {
      setError('')
      const data = await adminFetch('/api/scheduled-sessions/list')
      setSessions(data.sessions || [])
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (adminKey) loadSessions()
  }, [adminKey])

  const unlockAdmin = async (event) => {
    event.preventDefault()
    const key = keyInput.trim()
    if (!key) return
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key)
    setAdminKey(key)
    setKeyInput('')
  }

  const logout = () => {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE)
    setAdminKey('')
    setSessions([])
    setInviteUrl('')
    setSuccess('')
    setError('')
  }

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target
    setFormData(previous => ({
      ...previous,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleSubmit = async (event) => {
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
        accessWindow: { beforeStart: 15, afterEnd: 15 }
      }

      const data = await adminFetch('/api/scheduled-sessions/create', {
        method: 'POST',
        body: JSON.stringify(sessionData)
      })

      setSuccess(`Session created for ${data.session.candidateName}`)
      setInviteUrl(data.session.accessUrl || '')
      setFormData(emptyForm)
      await loadSessions()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyInvite = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setSuccess('Secure interview link copied to clipboard')
    } catch {
      setError('Could not copy automatically. Select and copy the link manually.')
    }
  }

  const formatDateTime = (date) => date ? new Date(date).toLocaleString() : '—'

  if (!adminKey) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <form onSubmit={unlockAdmin} className="w-full max-w-md bg-white rounded-xl shadow p-6 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recruiter Admin</h1>
            <p className="mt-1 text-sm text-gray-600">Enter the server admin key to manage interview sessions.</p>
          </div>
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            autoComplete="off"
            placeholder="ADMIN_API_KEY"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700">
            Open scheduler
          </button>
          <p className="text-xs text-gray-500">The key is kept only in this browser tab session and is never bundled into the frontend build.</p>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Session Scheduler</h1>
            <p className="text-gray-600">Create secure, time-bound candidate interview links.</p>
          </div>
          <button onClick={logout} className="text-sm px-3 py-2 border rounded-lg bg-white hover:bg-gray-100">Lock admin</button>
        </div>

        {error && <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 whitespace-pre-wrap">{error}</div>}
        {success && <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-700">{success}</div>}

        {inviteUrl && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="font-semibold text-blue-900">Secure candidate link</p>
            <div className="mt-2 flex gap-2">
              <input readOnly value={inviteUrl} className="flex-1 bg-white border rounded px-3 py-2 text-sm" />
              <button onClick={copyInvite} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Copy</button>
            </div>
            <p className="mt-2 text-xs text-blue-800">Treat this URL like a password because it contains the candidate’s access token.</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
            <h2 className="text-xl font-semibold">Create interview</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input required name="candidateId" value={formData.candidateId} onChange={handleInputChange} placeholder="Candidate ID" className="border rounded-lg px-3 py-2" />
              <input required name="candidateName" value={formData.candidateName} onChange={handleInputChange} placeholder="Candidate name" className="border rounded-lg px-3 py-2" />
              <input type="email" name="candidateEmail" value={formData.candidateEmail} onChange={handleInputChange} placeholder="Candidate email (optional)" className="border rounded-lg px-3 py-2" />
              <input name="companyName" value={formData.companyName} onChange={handleInputChange} placeholder="Company name" className="border rounded-lg px-3 py-2" />
            </div>

            <input name="position" value={formData.position} onChange={handleInputChange} placeholder="Position / role" className="w-full border rounded-lg px-3 py-2" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm text-gray-700">Start time
                <input required type="datetime-local" name="startTime" value={formData.startTime} onChange={handleInputChange} className="mt-1 w-full border rounded-lg px-3 py-2" />
              </label>
              <label className="text-sm text-gray-700">End time
                <input required type="datetime-local" name="endTime" value={formData.endTime} onChange={handleInputChange} className="mt-1 w-full border rounded-lg px-3 py-2" />
              </label>
            </div>

            <label className="block text-sm text-gray-700">Duration (minutes)
              <input type="number" min="15" max="240" name="duration" value={formData.duration} onChange={handleInputChange} className="mt-1 w-full border rounded-lg px-3 py-2" />
            </label>

            <input name="skills" value={formData.skills} onChange={handleInputChange} placeholder="Skills: React, Node.js, C++" className="w-full border rounded-lg px-3 py-2" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select name="experienceLevel" value={formData.experienceLevel} onChange={handleInputChange} className="border rounded-lg px-3 py-2">
                <option value="junior">Junior</option>
                <option value="intermediate">Intermediate</option>
                <option value="senior">Senior</option>
              </select>
              <input name="focusAreas" value={formData.focusAreas} onChange={handleInputChange} placeholder="technical,problem-solving" className="border rounded-lg px-3 py-2" />
            </div>

            <textarea name="customQuestions" value={formData.customQuestions} onChange={handleInputChange} rows="4" placeholder="Optional custom questions, one per line" className="w-full border rounded-lg px-3 py-2" />
            <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" placeholder="Internal notes" className="w-full border rounded-lg px-3 py-2" />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowCodeEditor" checked={formData.allowCodeEditor} onChange={handleInputChange} />
              Enable coding exercise
            </label>

            <button disabled={loading} type="submit" className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Creating…' : 'Create secure session'}
            </button>
          </form>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Scheduled sessions</h2>
              <button onClick={loadSessions} className="text-sm text-blue-600 hover:underline">Refresh</button>
            </div>

            <div className="space-y-3 max-h-[720px] overflow-auto">
              {sessions.map((session) => (
                <div key={session.sessionId} className="border rounded-lg p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{session.candidateName}</p>
                      <p className="text-sm text-gray-600">{session.position || session.role}</p>
                    </div>
                    <span className="text-xs uppercase font-semibold text-gray-600">{session.status}</span>
                  </div>
                  <div className="mt-3 text-sm text-gray-600 space-y-1">
                    <p>ID: {session.candidateId}</p>
                    <p>Start: {formatDateTime(session.startTime)}</p>
                    <p>End: {formatDateTime(session.endTime)}</p>
                    <p>Failed access attempts: {session.accessAttempts || 0}</p>
                  </div>
                </div>
              ))}
              {!sessions.length && <p className="text-center text-gray-500 py-10">No sessions found.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SessionScheduler
