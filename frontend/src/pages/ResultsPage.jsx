import { Download, Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import config from '../config'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function ResultsPage() {
  const { apiFetch, token } = useAuth()
  const [results, setResults] = useState([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (search) params.set('q', search)
      const data = await apiFetch(`/api/interview/results?${params}`)
      setResults(data.results || [])
      setPages(data.pages || 1)
      setTotal(data.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, page, search])

  useEffect(() => { load() }, [load])

  const openDetail = async result => {
    if (!result.fileName) return
    setDetailLoading(true)
    setError('')
    try {
      const data = await apiFetch(`/api/interview/results/${encodeURIComponent(result.fileName)}`)
      setDetail(data.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  const exportCsv = async () => {
    try {
      setError('')
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      const response = await fetch(`${config.AI_BACKEND_URL}/api/interview/results/export.csv?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to export results')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `interview-results-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600">Assessment history</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Interview results</h1>
          <p className="mt-2 text-sm text-slate-500">Review completed interviews and export recruiter-ready data.</p>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50"><Download size={17} /> Export CSV</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <form onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()) }} className="flex gap-2 w-full sm:max-w-xl">
            <div className="relative flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search candidate, role, session…" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
            <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Search</button>
          </form>
          <span className="text-sm text-slate-500">{total} results</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Candidate</th><th className="px-5 py-3">Interview</th><th className="px-5 py-3">Activity</th><th className="px-5 py-3">Score</th><th className="px-5 py-3">Date</th><th className="px-5 py-3"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((result, index) => (
                <tr key={`${result.fileName || result.sessionId}-${index}`} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4"><p className="font-medium text-slate-900">{result.candidateName || 'Candidate'}</p><p className="text-xs text-slate-500">{result.candidateEmail || result.sessionId || '—'}</p></td>
                  <td className="px-5 py-4 text-slate-600">{result.position || '—'}</td>
                  <td className="px-5 py-4 text-slate-500">{result.questionsAsked || 0} questions · {result.codingTestsCompleted || 0} coding</td>
                  <td className="px-5 py-4">{result.overallScore !== null && result.overallScore !== undefined ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{result.overallScore}</span> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-5 py-4 text-slate-500">{formatDate(result.date)}</td>
                  <td className="px-5 py-4 text-right"><button disabled={!result.fileName || detailLoading} onClick={() => openDetail(result)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40">Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !results.length && <div className="py-14 text-center text-sm text-slate-500">No interview results found.</div>}
          {loading && <div className="py-14 text-center text-sm text-slate-500">Loading results…</div>}
        </div>

        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-between text-sm"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Previous</button><span className="text-slate-500">Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Next</button></div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close" onClick={() => setDetail(null)} className="absolute inset-0 bg-slate-950/40" />
          <aside className="relative h-full w-full max-w-2xl bg-white shadow-2xl overflow-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-start justify-between z-10"><div><p className="text-xs uppercase tracking-wide text-blue-600">Interview report</p><h2 className="mt-1 text-xl font-semibold text-slate-900">{detail.candidateInfo?.name || detail.candidateName || 'Candidate'}</h2><p className="text-sm text-slate-500">{detail.candidateInfo?.position || detail.position || detail.sessionId || ''}</p></div><button onClick={() => setDetail(null)} className="p-2"><X size={20} /></button></div>
            <div className="p-6 space-y-6">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 border p-4"><p className="text-xs text-slate-400">Duration</p><p className="mt-1 font-semibold text-slate-900">{detail.interviewDetails?.duration ?? '—'}</p></div>
                <div className="rounded-xl bg-slate-50 border p-4"><p className="text-xs text-slate-400">Questions</p><p className="mt-1 font-semibold text-slate-900">{detail.interviewDetails?.totalQuestions ?? '—'}</p></div>
                <div className="rounded-xl bg-slate-50 border p-4"><p className="text-xs text-slate-400">Coding tests</p><p className="mt-1 font-semibold text-slate-900">{detail.interviewDetails?.codingTestsCompleted ?? '—'}</p></div>
              </div>

              {(detail.evaluation || detail.summary || detail.recommendation) && <section><h3 className="font-semibold text-slate-900 mb-2">Evaluation</h3><pre className="rounded-xl bg-slate-950 text-slate-100 p-4 text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(detail.evaluation || detail.summary || { recommendation: detail.recommendation }, null, 2)}</pre></section>}
              {Array.isArray(detail.transcript) && <section><h3 className="font-semibold text-slate-900 mb-3">Transcript</h3><div className="space-y-2">{detail.transcript.map((item, index) => <div key={index} className="rounded-lg border bg-slate-50 p-3 text-sm"><p className="text-xs font-semibold uppercase text-slate-400">{item.role || item.speaker || 'message'}</p><p className="mt-1 whitespace-pre-wrap text-slate-700">{item.content || item.text || JSON.stringify(item)}</p></div>)}</div></section>}
              <section><h3 className="font-semibold text-slate-900 mb-2">Raw result data</h3><details className="rounded-xl border bg-slate-50"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Open technical payload</summary><pre className="border-t p-4 text-xs overflow-auto whitespace-pre-wrap max-h-[420px]">{JSON.stringify(detail, null, 2)}</pre></details></section>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
