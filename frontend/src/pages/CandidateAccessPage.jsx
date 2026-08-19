import { AlertTriangle, CheckCircle2, LockKeyhole } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import config from '../config'

function inviteCredentials() {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return {
    candidateId: query.get('candidateId') || hash.get('candidateId') || '',
    sessionId: query.get('sessionId') || hash.get('sessionId') || '',
    accessToken: hash.get('accessToken') || query.get('accessToken') || ''
  }
}

export default function CandidateAccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const startedRef = useRef(false)
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState(location.state?.message || '')
  const [sessionInfo, setSessionInfo] = useState(null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const credentials = inviteCredentials()
    // Remove credentials from browser history as soon as JavaScript captures them.
    window.history.replaceState({}, document.title, window.location.pathname)

    if (!credentials.candidateId || !credentials.accessToken) {
      setStatus('missing')
      setMessage(location.state?.message || 'This interview link is incomplete. Please open the complete secure link sent by your recruiter.')
      return
    }

    let cancelled = false
    const accessInterview = async () => {
      try {
        setStatus('checking')
        const response = await fetch(`${config.AI_BACKEND_URL}/api/sessions/access-by-candidate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Interview-Token': credentials.accessToken
          },
          body: JSON.stringify({
            candidateId: credentials.candidateId,
            sessionId: credentials.sessionId || undefined,
            accessToken: credentials.accessToken
          })
        })
        const data = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }))
        if (cancelled) return

        if (!response.ok || !data.success || !data.session) {
          if (response.status === 403 && data.sessionInfo) {
            setSessionInfo(data.sessionInfo)
            setStatus('timing')
            setMessage(data.error || data.message || 'This interview is outside its allowed access window.')
            return
          }
          throw new Error(data.error || data.message || `Interview access failed (${response.status})`)
        }

        const session = {
          ...data.session,
          candidateId: data.session.candidateId || credentials.candidateId,
          sessionId: data.session.sessionId || credentials.sessionId,
          accessToken: data.session.accessToken || credentials.accessToken,
          interviewData: data.interviewData || data.session.interviewData
        }
        sessionStorage.setItem('interviewSession', JSON.stringify(session))
        setStatus('ready')
        window.setTimeout(() => navigate('/interview-session', { replace: true }), 250)
      } catch (error) {
        if (cancelled) return
        setStatus('error')
        setMessage(error.message || 'Unable to access this interview. Ask your recruiter for a fresh invite link.')
      }
    }

    accessInterview()
    return () => { cancelled = true }
  }, [location.state, navigate])

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-7 sm:p-9 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-blue-600 flex items-center justify-center font-bold">IB</div>
          <div><p className="font-semibold">InterviewBuddy</p><p className="text-xs text-slate-400">Secure Candidate Assessment</p></div>
        </div>

        <div className="mt-8 text-center">
          {status === 'checking' && <div className="mx-auto h-12 w-12 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin" />}
          {status === 'ready' && <CheckCircle2 className="mx-auto text-emerald-400" size={48} />}
          {(status === 'missing' || status === 'error' || status === 'timing') && <AlertTriangle className="mx-auto text-amber-400" size={48} />}
          <h1 className="mt-5 text-2xl font-semibold">
            {status === 'checking' && 'Verifying secure interview link'}
            {status === 'ready' && 'Interview access verified'}
            {status === 'missing' && 'Secure invite required'}
            {status === 'error' && 'Unable to open interview'}
            {status === 'timing' && 'Interview not accessible yet'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {status === 'checking' && 'We are validating your signed invite and interview access window.'}
            {status === 'ready' && 'Opening your interview workspace…'}
            {(status === 'missing' || status === 'error' || status === 'timing') && message}
          </p>
        </div>

        {sessionInfo && (
          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500">Candidate</p><p className="mt-1">{sessionInfo.candidateName || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Role</p><p className="mt-1">{sessionInfo.role || sessionInfo.position || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Scheduled</p><p className="mt-1">{sessionInfo.scheduledStartTime ? new Date(sessionInfo.scheduledStartTime).toLocaleString() : '—'}</p></div>
              <div><p className="text-xs text-slate-500">Access opens</p><p className="mt-1">{sessionInfo.accessibleFrom ? new Date(sessionInfo.accessibleFrom).toLocaleString() : '—'}</p></div>
            </div>
          </div>
        )}

        <div className="mt-7 flex items-start gap-3 rounded-xl border border-blue-900/60 bg-blue-950/40 p-4 text-left">
          <LockKeyhole size={19} className="mt-0.5 shrink-0 text-blue-400" />
          <p className="text-xs leading-5 text-blue-200">Candidate IDs are never passwords. Interview access requires the complete signed invite from your recruiter. Credentials are kept only for this browser tab.</p>
        </div>
      </div>
    </div>
  )
}
