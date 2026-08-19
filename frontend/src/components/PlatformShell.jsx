import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const navigation = [
  { to: '/platform', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/platform/schedule', label: 'Interviews', icon: CalendarDays, roles: ['owner', 'admin', 'recruiter'] },
  { to: '/platform/candidates', label: 'Candidates', icon: Users },
  { to: '/platform/results', label: 'Results', icon: ClipboardList },
  { to: '/platform/team', label: 'Team', icon: ShieldCheck, roles: ['owner', 'admin'] },
  { to: '/platform/audit', label: 'Audit log', icon: Activity, roles: ['owner', 'admin'] },
  { to: '/platform/settings', label: 'Settings', icon: Settings }
]

export default function PlatformShell() {
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const items = navigation.filter(item => !item.roles || item.roles.includes(user?.role))

  const sidebar = (
    <div className="h-full flex flex-col bg-slate-950 text-white">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold">IB</div>
          <div>
            <p className="font-semibold leading-tight">InterviewBuddy</p>
            <p className="text-xs text-slate-400">Recruiter Workspace</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="mb-3">
          <p className="text-sm font-medium truncate">{user?.name}</p>
          <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-blue-300">{user?.role}</p>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-md p-2 text-slate-300 hover:bg-slate-800"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64 min-h-screen">
        <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-700"
            >
              <Menu size={20} />
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-900">{user?.organizationName || 'InterviewBuddy'}</p>
              <p className="text-xs text-slate-500">AI Interview Operations</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Secure workspace
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
