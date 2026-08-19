import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import ProtectedRoute from './auth/ProtectedRoute.jsx'
import PlatformShell from './components/PlatformShell.jsx'
import SessionScheduler from './components/SessionScheduler.jsx'
import AuditPage from './pages/AuditPage.jsx'
import CandidateAccessPage from './pages/CandidateAccessPage.jsx'
import CandidatesPage from './pages/CandidatesPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import RecruiterLogin from './pages/RecruiterLogin.jsx'
import ResultsPage from './pages/ResultsPage.jsx'
import SecureInterviewHost from './pages/SecureInterviewHost.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import TeamPage from './pages/TeamPage.jsx'

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<CandidateAccessPage />} />
          <Route path="/interview" element={<CandidateAccessPage />} />
          <Route path="/interview-session" element={<SecureInterviewHost />} />
          <Route path="/platform/login" element={<RecruiterLogin />} />
          <Route path="/admin/schedule" element={<Navigate to="/platform/schedule" replace />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/platform" element={<PlatformShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="candidates" element={<CandidatesPage />} />
              <Route path="results" element={<ResultsPage />} />
              <Route path="settings" element={<SettingsPage />} />

              <Route element={<ProtectedRoute roles={['owner', 'admin', 'recruiter']} />}>
                <Route path="schedule" element={<SessionScheduler />} />
              </Route>

              <Route element={<ProtectedRoute roles={['owner', 'admin']} />}>
                <Route path="team" element={<TeamPage />} />
                <Route path="audit" element={<AuditPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App
