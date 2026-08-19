import { Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const emptyCandidate = {
  candidateId: '',
  candidateName: '',
  candidateEmail: '',
  phoneNumber: '',
  position: 'Software Developer',
  skills: '',
  experience: '',
  education: '',
  projectDetails: '',
  githubProjects: ''
}

export default function CandidatesPage() {
  const { apiFetch, user } = useAuth()
  const canManage = user?.role !== 'reviewer'
  const [candidates, setCandidates] = useState([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyCandidate)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (search) params.set('q', search)
      const data = await apiFetch(`/api/candidate/list?${params}`)
      setCandidates(data.candidates || [])
      setPages(data.pages || 1)
      setTotal(data.total || 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, page, search])

  useEffect(() => { loadCandidates() }, [loadCandidates])

  const submitSearch = event => {
    event.preventDefault()
    setPage(1)
    setSearch(query.trim())
  }

  const createCandidate = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiFetch('/api/candidate/save', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          skills: form.skills.split(',').map(value => value.trim()).filter(Boolean)
        })
      })
      setForm(emptyCandidate)
      setShowForm(false)
      setPage(1)
      await loadCandidates()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const loadDetail = async candidateId => {
    try {
      setError('')
      const data = await apiFetch(`/api/candidate/load/${encodeURIComponent(candidateId)}`)
      setSelected(data.profile)
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteCandidate = async candidate => {
    if (!window.confirm(`Delete ${candidate.candidateName}? This also removes saved coding questions for the candidate.`)) return
    try {
      await apiFetch(`/api/candidate/delete/${encodeURIComponent(candidate.candidateId)}`, { method: 'DELETE' })
      if (selected?.candidateId === candidate.candidateId) setSelected(null)
      await loadCandidates()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600">Talent pool</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">Candidates</h1>
          <p className="mt-2 text-sm text-slate-500">Search and maintain interview-ready candidate profiles.</p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            <Plus size={17} /> Add candidate
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <form onSubmit={submitSearch} className="flex gap-2 w-full sm:max-w-xl">
            <div className="relative flex-1">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, ID, role, skill…" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
            </div>
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">Search</button>
          </form>
          <p className="text-sm text-slate-500">{total} total</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Candidate</th><th className="px-5 py-3">Position</th><th className="px-5 py-3">Skills</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidates.map(candidate => (
                <tr key={candidate.candidateId} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <button onClick={() => loadDetail(candidate.candidateId)} className="text-left">
                      <p className="font-medium text-slate-900 hover:text-blue-600">{candidate.candidateName}</p>
                      <p className="text-xs text-slate-500">{candidate.candidateEmail || candidate.candidateId}</p>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{candidate.position || '—'}</td>
                  <td className="px-5 py-4"><div className="flex flex-wrap gap-1">{(candidate.skills || []).slice(0, 4).map(skill => <span key={skill} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{skill}</span>)}{(candidate.skills || []).length > 4 && <span className="text-xs text-slate-400">+{candidate.skills.length - 4}</span>}</div></td>
                  <td className="px-5 py-4 text-slate-500">{candidate.updatedAt ? new Date(candidate.updatedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => loadDetail(candidate.candidateId)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50">View</button>
                      {canManage && <button onClick={() => deleteCandidate(candidate)} className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50" aria-label="Delete candidate"><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !candidates.length && <div className="py-14 text-center text-sm text-slate-500">No candidates found.</div>}
          {loading && <div className="py-14 text-center text-sm text-slate-500">Loading candidates…</div>}
        </div>

        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-between text-sm">
          <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span className="text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(value => value + 1)} className="rounded-md border px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Close" onClick={() => setShowForm(false)} className="absolute inset-0 bg-slate-950/60" />
          <form onSubmit={createCandidate} className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-2xl bg-white shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5"><div><h2 className="text-xl font-semibold">Add candidate</h2><p className="text-sm text-slate-500">Create a reusable interview profile.</p></div><button type="button" onClick={() => setShowForm(false)} className="p-2"><X size={20} /></button></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <input required placeholder="Candidate ID" value={form.candidateId} onChange={e => setForm(v => ({ ...v, candidateId: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <input required placeholder="Full name" value={form.candidateName} onChange={e => setForm(v => ({ ...v, candidateName: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <input type="email" placeholder="Email" value={form.candidateEmail} onChange={e => setForm(v => ({ ...v, candidateEmail: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <input placeholder="Phone" value={form.phoneNumber} onChange={e => setForm(v => ({ ...v, phoneNumber: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <input placeholder="Position" value={form.position} onChange={e => setForm(v => ({ ...v, position: e.target.value }))} className="rounded-lg border px-3 py-2.5 sm:col-span-2" />
              <input placeholder="Skills, comma separated" value={form.skills} onChange={e => setForm(v => ({ ...v, skills: e.target.value }))} className="rounded-lg border px-3 py-2.5 sm:col-span-2" />
              <input placeholder="Experience" value={form.experience} onChange={e => setForm(v => ({ ...v, experience: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <input placeholder="Education" value={form.education} onChange={e => setForm(v => ({ ...v, education: e.target.value }))} className="rounded-lg border px-3 py-2.5" />
              <textarea rows="3" placeholder="Project details" value={form.projectDetails} onChange={e => setForm(v => ({ ...v, projectDetails: e.target.value }))} className="rounded-lg border px-3 py-2.5 sm:col-span-2" />
              <textarea rows="2" placeholder="GitHub / project links" value={form.githubProjects} onChange={e => setForm(v => ({ ...v, githubProjects: e.target.value }))} className="rounded-lg border px-3 py-2.5 sm:col-span-2" />
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50">{saving ? 'Saving…' : 'Save candidate'}</button></div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close" onClick={() => setSelected(null)} className="absolute inset-0 bg-slate-950/40" />
          <aside className="relative h-full w-full max-w-xl bg-white shadow-2xl overflow-auto p-6">
            <div className="flex items-start justify-between"><div className="flex gap-3"><div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><UserRound /></div><div><h2 className="text-xl font-semibold text-slate-900">{selected.candidateName}</h2><p className="text-sm text-slate-500">{selected.position || 'Candidate'} · {selected.candidateId}</p></div></div><button onClick={() => setSelected(null)} className="p-2"><X size={20} /></button></div>
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs text-slate-400">Email</p><p className="mt-1 text-slate-800 break-all">{selected.candidateEmail || '—'}</p></div><div><p className="text-xs text-slate-400">Phone</p><p className="mt-1 text-slate-800">{selected.phoneNumber || '—'}</p></div><div><p className="text-xs text-slate-400">Experience</p><p className="mt-1 text-slate-800">{selected.experience || '—'}</p></div><div><p className="text-xs text-slate-400">Education</p><p className="mt-1 text-slate-800">{selected.education || '—'}</p></div></div>
            <div className="mt-6"><p className="text-xs text-slate-400 mb-2">Skills</p><div className="flex flex-wrap gap-2">{(selected.skills || []).map(skill => <span key={skill} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{skill}</span>)}</div></div>
            <div className="mt-6"><p className="text-xs text-slate-400">Project details</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{selected.projectDetails || 'No project details added.'}</p></div>
            <div className="mt-6"><p className="text-xs text-slate-400">Project links</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 break-all">{selected.githubProjects || '—'}</p></div>
          </aside>
        </div>
      )}
    </div>
  )
}
