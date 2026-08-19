import { Activity, CalendarClock, CheckCircle2, ClipboardCheck, UserRound, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const cards = [
  { key: 'candidates', label: 'Candidates', icon: UserRound },
  { key: 'interviews', label: 'Total interviews', icon: ClipboardCheck },
  { key: 'activeInterviews', label: 'Active now', icon: Activity },
  { key: 'upcomingInterviews', label: 'Next 7 days', icon: CalendarClock },
  { key: 'completedInterviews', label: 'Completed', icon: CheckCircle2 },
  { key: 'teamMembers', label: 'Team members', icon: Users }
]

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
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

export default function DashboardPage() {
  const { apiFetch, user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setError('')
      const response = await apiFetch('/api/platform/dashboard')
      setData(response)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    load()
    const interval = window.setInterval(load, 30000)
    return () => window.clearInterval(interval)
  }, [load])

  const stats = data?.stats || {}

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600">Operations overview</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Welcome back, {user?.name?.split(' ')[0] || 'Recruiter'}</h1>
          <p className="mt-2 text-sm text-slate-500">Live snapshot of candidates, interviews, results, and team activity.</p>
        </div>
        {user?.role !== 'reviewer' && (
          <Link to="/platform/schedule" className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">Schedule interview</Link>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 sm:gap-4">
        {cards.map(({ key, label, icon: Icon }) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <Icon size={18} className="text-blue-600" />
              {loading && <span className="h-2 w-2 rounded-full bg-slate-300 animate-pulse" />}
            </div>
            <p className="mt-4 text-2xl font-semibold text-slate-950">{stats[key] ?? '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1.35fr_0.65fr] gap-6">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div><h2 className="font-semibold text-slate-900">Recent interviews</h2><p className="text-xs text-slate-500 mt-1">Latest session activity</p></div>
            <Link to="/platform/schedule" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {(data?.recentSessions || []).map(session => (
              <div key={session.sessionId} className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{session.candidateName}</p>
                  <p className="text-sm text-slate-500 truncate">{session.position || 'Interview'} · {formatDate(session.startTime)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(session.status)}`}>{session.status || 'unknown'}</span>
              </div>
            ))}
            {!loading && !(data?.recentSessions || []).length && <p className="p-8 text-center text-sm text-slate-500">No interviews yet.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div><h2 className="font-semibold text-slate-900">Completion</h2><p className="text-xs text-slate-500 mt-1">Terminal interview outcomes</p></div>
            <span className="text-2xl font-semibold text-slate-950">{stats.completionRate ?? 0}%</span>
          </div>
          <div className="mt-5 h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, stats.completionRate || 0))}%` }} />
          </div>
          <div className="mt-6 space-y-3 text-sm">
            {Object.entries(data?.sessionsByStatus || {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="capitalize text-slate-600">{status}</span>
                <span className="font-medium text-slate-900">{count}</span>
              </div>
            ))}
            {!Object.keys(data?.sessionsByStatus || {}).length && <p className="text-slate-500">No session data yet.</p>}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div><h2 className="font-semibold text-slate-900">Latest results</h2><p className="text-xs text-slate-500 mt-1">Recently completed assessments</p></div>
          <Link to="/platform/results" className="text-sm text-blue-600 hover:underline">Open results</Link>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          {(data?.recentResults || []).slice(0, 4).map((result, index) => (
            <div key={`${result.fileName || result.sessionId}-${index}`} className="p-5">
              <p className="font-medium text-slate-900 truncate">{result.candidateName || 'Candidate'}</p>
              <p className="mt-1 text-sm text-slate-500 truncate">{result.position || 'Interview'}</p>
              <p className="mt-4 text-xs text-slate-400">{formatDate(result.date)}</p>
              <p className="mt-2 text-xs text-slate-500">{result.questionsAsked || 0} questions · {result.codingTestsCompleted || 0} coding tests</p>
            </div>
          ))}
          {!loading && !(data?.recentResults || []).length && <p className="p-8 text-sm text-slate-500">No completed interview results yet.</p>}
        </div>
      </section>
    </div>
  )
}
