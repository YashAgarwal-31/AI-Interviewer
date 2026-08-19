import { Activity, Database, Mail, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

function statusTone(ok) {
  return ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
}

export default function AuditPage() {
  const { apiFetch } = useAuth()
  const [logs, setLogs] = useState([])
  const [system, setSystem] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const [auditData, systemData] = await Promise.all([
        apiFetch('/api/platform/audit?limit=100'),
        apiFetch('/api/platform/system')
      ])
      setLogs(auditData.logs || [])
      setSystem(systemData.system || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  const visibleLogs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(log => [log.actorEmail, log.action, log.path, log.requestId, log.ip]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q)))
  }, [logs, filter])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div><p className="text-sm font-medium text-blue-600">Security & operations</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">Audit & system</h1><p className="mt-2 text-sm text-slate-500">Trace recruiter actions and check production dependencies.</p></div>
        <button onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`rounded-xl border p-4 ${statusTone(system?.mongoConnected)}`}><Database size={19} /><p className="mt-3 font-medium">MongoDB</p><p className="mt-1 text-xs">{system?.mongoConnected ? 'Connected' : 'Unavailable'}</p></div>
        <div className={`rounded-xl border p-4 ${statusTone(system?.openaiConfigured)}`}><Sparkles size={19} /><p className="mt-3 font-medium">OpenAI</p><p className="mt-1 text-xs">{system?.openaiConfigured ? 'Configured' : 'Fallback mode'}</p></div>
        <div className={`rounded-xl border p-4 ${statusTone(system?.emailConfigured)}`}><Mail size={19} /><p className="mt-3 font-medium">Email</p><p className="mt-1 text-xs">{system?.emailConfigured ? 'Configured' : 'Not configured'}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><Activity size={19} className="text-blue-600" /><p className="mt-3 font-medium text-slate-900">Runtime</p><p className="mt-1 text-xs text-slate-500">{system ? `${system.environment} · ${Math.round((system.uptimeSeconds || 0) / 60)} min uptime` : 'Loading…'}</p></div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Recent audit events</h2><p className="mt-1 text-xs text-slate-500">Stored for up to 180 days.</p></div><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter actor, action, route, request ID…" className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500" /></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Actor</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Route</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Request</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleLogs.map(log => (
                <tr key={log.id} className="align-top">
                  <td className="px-5 py-4 whitespace-nowrap text-slate-500">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                  <td className="px-5 py-4"><p className="text-slate-800">{log.actorEmail || log.actorType || 'system'}</p><p className="text-xs text-slate-400">{log.ip || '—'}</p></td>
                  <td className="px-5 py-4 font-medium text-slate-800">{log.action}</td>
                  <td className="px-5 py-4 max-w-sm truncate text-slate-500" title={log.path}>{log.method ? `${log.method} ` : ''}{log.path || '—'}</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs ${Number(log.statusCode) >= 400 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{log.statusCode || '—'}</span></td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-400">{log.requestId?.slice(0, 12) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !visibleLogs.length && <div className="py-14 text-center text-sm text-slate-500">No matching audit events.</div>}
          {loading && <div className="py-14 text-center text-sm text-slate-500">Loading audit history…</div>}
        </div>
      </div>
    </div>
  )
}
