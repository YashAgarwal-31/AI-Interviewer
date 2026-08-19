import { LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import config from '../config'

const loginInitial = { email: '', password: '' }
const bootstrapInitial = { name: '', email: '', password: '', organizationName: 'InterviewBuddy', adminKey: '' }

export default function RecruiterLogin() {
  const { login, bootstrap, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [requiresBootstrap, setRequiresBootstrap] = useState(false)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState('login')
  const [loginForm, setLoginForm] = useState(loginInitial)
  const [bootstrapForm, setBootstrapForm] = useState(bootstrapInitial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${config.AI_BACKEND_URL}/api/auth/bootstrap-status`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not check account setup')
        setRequiresBootstrap(Boolean(data.requiresBootstrap))
        if (data.requiresBootstrap) setMode('bootstrap')
      })
      .catch(err => setError(err.message))
      .finally(() => setChecking(false))
  }, [])

  if (isAuthenticated) return <Navigate to="/platform" replace />

  const afterLogin = () => {
    const target = location.state?.from?.startsWith('/platform') ? location.state.from : '/platform'
    navigate(target, { replace: true })
  }

  const handleLogin = async event => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login(loginForm)
      afterLogin()
    } catch (err) {
      setError(err.requestId ? `${err.message} · Request ${err.requestId}` : err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBootstrap = async event => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await bootstrap(bootstrapForm)
      afterLogin()
    } catch (err) {
      setError(err.requestId ? `${err.message} · Request ${err.requestId}` : err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 border-r border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-blue-600 flex items-center justify-center font-bold">IB</div>
          <div>
            <h1 className="font-semibold text-lg">InterviewBuddy</h1>
            <p className="text-xs text-slate-400">AI Interview Operations Platform</p>
          </div>
        </div>

        <div className="max-w-xl">
          <Sparkles className="text-blue-400 mb-5" size={34} />
          <h2 className="text-4xl font-semibold leading-tight">Run structured AI interviews without sharing admin secrets.</h2>
          <p className="mt-5 text-slate-300 leading-7">Recruiters get named accounts, secure sessions, team roles, audit history, candidate operations, scheduling, and interview results in one workspace.</p>
          <div className="mt-8 grid grid-cols-2 gap-4 text-sm text-slate-300">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4"><ShieldCheck className="mb-2 text-emerald-400" size={20} />Role-based access</div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4"><LockKeyhole className="mb-2 text-blue-400" size={20} />Expiring sessions</div>
          </div>
        </div>

        <p className="text-xs text-slate-500">Candidate interview links remain separate, time-bound credentials.</p>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold">IB</div>
            <div><p className="font-semibold">InterviewBuddy</p><p className="text-xs text-slate-400">Recruiter Workspace</p></div>
          </div>

          {checking ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">Checking workspace setup…</div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl">
              <div className="mb-6">
                <p className="text-xs uppercase tracking-[0.2em] text-blue-400">Secure access</p>
                <h2 className="mt-2 text-2xl font-semibold">{mode === 'bootstrap' ? 'Create platform owner' : 'Sign in to workspace'}</h2>
                <p className="mt-2 text-sm text-slate-400">
                  {mode === 'bootstrap' ? 'One-time setup for the first owner account.' : 'Use your recruiter or reviewer account.'}
                </p>
              </div>

              {error && <div className="mb-5 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</div>}

              {mode === 'bootstrap' ? (
                <form onSubmit={handleBootstrap} className="space-y-4">
                  <input required placeholder="Your name" value={bootstrapForm.name} onChange={e => setBootstrapForm(v => ({ ...v, name: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <input required type="email" placeholder="Work email" value={bootstrapForm.email} onChange={e => setBootstrapForm(v => ({ ...v, email: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <input required placeholder="Organization" value={bootstrapForm.organizationName} onChange={e => setBootstrapForm(v => ({ ...v, organizationName: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <input required type="password" placeholder="Password (12+ chars, Aa1)" value={bootstrapForm.password} onChange={e => setBootstrapForm(v => ({ ...v, password: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <input required type="password" autoComplete="off" placeholder="Server ADMIN_API_KEY" value={bootstrapForm.adminKey} onChange={e => setBootstrapForm(v => ({ ...v, adminKey: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <button disabled={submitting} className="w-full rounded-lg bg-blue-600 py-2.5 font-medium hover:bg-blue-500 disabled:opacity-50">{submitting ? 'Creating…' : 'Create owner account'}</button>
                  {!requiresBootstrap && <button type="button" onClick={() => { setMode('login'); setError('') }} className="w-full text-sm text-slate-400 hover:text-white">Back to sign in</button>}
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <input required type="email" autoComplete="email" placeholder="Work email" value={loginForm.email} onChange={e => setLoginForm(v => ({ ...v, email: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <input required type="password" autoComplete="current-password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm(v => ({ ...v, password: e.target.value }))} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500" />
                  <button disabled={submitting} className="w-full rounded-lg bg-blue-600 py-2.5 font-medium hover:bg-blue-500 disabled:opacity-50">{submitting ? 'Signing in…' : 'Sign in'}</button>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
