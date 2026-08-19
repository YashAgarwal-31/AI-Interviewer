import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ roles = null }) {
  const { user, loading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full border-4 border-slate-700 border-t-blue-500 animate-spin mx-auto" />
          <p className="mt-4 text-sm text-slate-400">Loading secure workspace…</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />
  }

  if (roles && !roles.includes(user?.role)) {
    return <Navigate to="/platform" replace />
  }

  return <Outlet />
}
