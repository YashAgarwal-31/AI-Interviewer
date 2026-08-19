import { KeyRound, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'

export default function SettingsPage() {
  const { apiFetch, user, refreshMe, logout } = useAuth()
  const [profile, setProfile] = useState({ name: '', organizationName: '' })
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setProfile({
      name: user?.name || '',
      organizationName: user?.organizationName || 'InterviewBuddy'
    })
  }, [user])

  const saveProfile = async event => {
    event.preventDefault()
    setProfileSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = { name: profile.name }
      if (['owner', 'admin'].includes(user?.role)) payload.organizationName = profile.organizationName
      await apiFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) })
      await refreshMe()
      setSuccess('Profile updated successfully.')
    } catch (err) {
      setError(err.message)
    } finally {
      setProfileSaving(false)
    }
  }

  const changePassword = async event => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    setPasswordSaving(true)
    try {
      const data = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword
        })
      })
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setSuccess(data.message || 'Password changed successfully.')
    } catch (err) {
      setError(err.message)
    } finally {
      setPasswordSaving(false)
    }
  }

  const signOutEverywhere = async () => {
    if (!window.confirm('Sign out every active session for this account, including this browser?')) return
    try {
      await apiFetch('/api/auth/logout-all', { method: 'POST' })
    } catch {
      // Clear the local browser session even if the response is interrupted.
    }
    await logout()
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-sm font-medium text-blue-600">Workspace account</p>
        <h1 className="mt-1 text-3xl font-semibold text-slate-950">Settings</h1>
        <p className="mt-2 text-sm text-slate-500">Manage your profile, organization label, password, and active access.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={saveProfile} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><UserRound size={19} /></div>
            <div><h2 className="font-semibold text-slate-900">Profile</h2><p className="text-xs text-slate-500">Your recruiter identity</p></div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-slate-600">Name<input required value={profile.name} onChange={e => setProfile(value => ({ ...value, name: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" /></label>
            <label className="block text-xs font-medium text-slate-600">Email<input readOnly value={user?.email || ''} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500" /></label>
            <label className="block text-xs font-medium text-slate-600">Role<input readOnly value={user?.role || ''} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm capitalize text-slate-500" /></label>
            {['owner', 'admin'].includes(user?.role) && <label className="block text-xs font-medium text-slate-600">Organization<input value={profile.organizationName} onChange={e => setProfile(value => ({ ...value, organizationName: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" /></label>}
          </div>

          <button disabled={profileSaving} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><Save size={16} /> {profileSaving ? 'Saving…' : 'Save profile'}</button>
        </form>

        <form onSubmit={changePassword} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><KeyRound size={19} /></div>
            <div><h2 className="font-semibold text-slate-900">Password</h2><p className="text-xs text-slate-500">Other sessions are revoked after a change</p></div>
          </div>

          <div className="mt-5 space-y-4">
            <input required type="password" autoComplete="current-password" placeholder="Current password" value={passwords.currentPassword} onChange={e => setPasswords(value => ({ ...value, currentPassword: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required type="password" autoComplete="new-password" placeholder="New password (12+ chars, Aa1)" value={passwords.newPassword} onChange={e => setPasswords(value => ({ ...value, newPassword: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required type="password" autoComplete="new-password" placeholder="Confirm new password" value={passwords.confirmPassword} onChange={e => setPasswords(value => ({ ...value, confirmPassword: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </div>

          <button disabled={passwordSaving} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"><ShieldCheck size={16} /> {passwordSaving ? 'Changing…' : 'Change password'}</button>
        </form>
      </div>

      <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Active sessions</h2>
        <p className="mt-1 text-sm text-slate-500">Use this if you signed in on a shared computer or suspect another session is active.</p>
        <button onClick={signOutEverywhere} className="mt-4 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50">Sign out everywhere</button>
      </section>
    </div>
  )
}
