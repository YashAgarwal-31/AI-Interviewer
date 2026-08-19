import { KeyRound, Plus, Shield, UserCheck, UserX, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const newMemberInitial = { name: '', email: '', role: 'recruiter', password: '' }

export default function TeamPage() {
  const { apiFetch, user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(newMemberInitial)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setError('')
      const data = await apiFetch('/api/platform/team')
      setMembers(data.users || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  const createMember = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch('/api/platform/team', { method: 'POST', body: JSON.stringify(form) })
      setShowCreate(false)
      setForm(newMemberInitial)
      setSuccess(`${data.user.name} was added to the workspace.`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const updateMember = async (member, patch) => {
    setError('')
    setSuccess('')
    try {
      const data = await apiFetch(`/api/platform/team/${member.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setSuccess(`${data.user.name} was updated.`)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const resetPassword = async member => {
    const password = window.prompt(`Enter a new temporary password for ${member.name}. It must be 12+ characters with uppercase, lowercase, and a number.`)
    if (!password) return
    setError('')
    try {
      await apiFetch(`/api/platform/team/${member.id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: password }) })
      setSuccess(`Password reset for ${member.name}. All of their existing sessions were signed out.`)
    } catch (err) {
      setError(err.message)
    }
  }

  const assignableRoles = user?.role === 'owner' ? ['admin', 'recruiter', 'reviewer'] : ['recruiter', 'reviewer']

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div><p className="text-sm font-medium text-blue-600">Access control</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">Team</h1><p className="mt-2 text-sm text-slate-500">Named accounts replace shared recruiter credentials.</p></div>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"><Plus size={17} /> Add team member</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Member</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Last login</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {members.map(member => {
                const isSelf = member.id === user?.id
                const canChangeRole = member.role !== 'owner' && !isSelf
                return (
                  <tr key={member.id}>
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500"><Shield size={16} /></div><div><p className="font-medium text-slate-900">{member.name}{isSelf ? ' (you)' : ''}</p><p className="text-xs text-slate-500">{member.email}</p></div></div></td>
                    <td className="px-5 py-4">
                      {canChangeRole ? (
                        <select value={member.role} onChange={e => updateMember(member, { role: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                          {assignableRoles.map(role => <option key={role} value={role}>{role}</option>)}
                          {!assignableRoles.includes(member.role) && <option value={member.role}>{member.role}</option>}
                        </select>
                      ) : <span className="capitalize text-slate-700">{member.role}</span>}
                    </td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${member.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{member.isActive ? 'Active' : 'Disabled'}</span></td>
                    <td className="px-5 py-4 text-slate-500">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : 'Never'}</td>
                    <td className="px-5 py-4"><div className="flex justify-end gap-2"><button onClick={() => resetPassword(member)} className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Reset password"><KeyRound size={15} /></button>{!isSelf && member.role !== 'owner' && <button onClick={() => updateMember(member, { isActive: !member.isActive })} className={`rounded-md border p-2 ${member.isActive ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`} title={member.isActive ? 'Disable account' : 'Enable account'}>{member.isActive ? <UserX size={15} /> : <UserCheck size={15} />}</button>}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {loading && <div className="py-14 text-center text-sm text-slate-500">Loading team…</div>}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        <div className="rounded-xl border bg-white p-4"><p className="font-medium text-slate-900">Admin</p><p className="mt-1 text-slate-500">Can manage users, candidates, schedules, results, and audit history.</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="font-medium text-slate-900">Recruiter</p><p className="mt-1 text-slate-500">Can manage candidates and interviews, but cannot administer team access.</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="font-medium text-slate-900">Reviewer</p><p className="mt-1 text-slate-500">Read-only access to candidates and interview results.</p></div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Close" onClick={() => setShowCreate(false)} className="absolute inset-0 bg-slate-950/60" />
          <form onSubmit={createMember} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex justify-between items-start"><div><h2 className="text-xl font-semibold">Add team member</h2><p className="mt-1 text-sm text-slate-500">Create a named account with least-privilege access.</p></div><button type="button" onClick={() => setShowCreate(false)} className="p-2"><X size={20} /></button></div>
            <div className="mt-5 space-y-3">
              <input required placeholder="Full name" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5" />
              <input required type="email" placeholder="Work email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5" />
              <select value={form.role} onChange={e => setForm(v => ({ ...v, role: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5">{assignableRoles.map(role => <option key={role} value={role}>{role}</option>)}</select>
              <input required type="password" placeholder="Temporary password (12+ chars, Aa1)" value={form.password} onChange={e => setForm(v => ({ ...v, password: e.target.value }))} className="w-full rounded-lg border px-3 py-2.5" />
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={saving} className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50">{saving ? 'Creating…' : 'Create account'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
