import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import config from '../config'

const TOKEN_KEY = 'ai_interviewer_platform_token'
const AuthContext = createContext(null)

async function parseResponse(response) {
  const data = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }))
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status})`)
    error.status = response.status
    error.requestId = data.requestId || response.headers.get('x-request-id')
    throw error
  }
  return data
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(token))

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUser(null)
    setLoading(false)
  }, [])

  const apiFetch = useCallback(async (path, options = {}) => {
    const headers = new Headers(options.headers || {})
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (options.body && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${config.AI_BACKEND_URL}${path}`, { ...options, headers })
    try {
      return await parseResponse(response)
    } catch (error) {
      if (error.status === 401 && token) clearSession()
      throw error
    }
  }, [token, clearSession])

  const refreshMe = useCallback(async () => {
    if (!token) {
      setUser(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    try {
      const data = await apiFetch('/api/auth/me')
      setUser(data.user)
      return data.user
    } catch {
      clearSession()
      return null
    } finally {
      setLoading(false)
    }
  }, [token, apiFetch, clearSession])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const saveAuth = useCallback((data) => {
    sessionStorage.setItem(TOKEN_KEY, data.token)
    setToken(data.token)
    setUser(data.user)
    setLoading(false)
  }, [])

  const login = useCallback(async ({ email, password }) => {
    const response = await fetch(`${config.AI_BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await parseResponse(response)
    saveAuth(data)
    return data
  }, [saveAuth])

  const bootstrap = useCallback(async ({ name, email, password, organizationName, adminKey }) => {
    const response = await fetch(`${config.AI_BACKEND_URL}/api/auth/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey
      },
      body: JSON.stringify({ name, email, password, organizationName })
    })
    const data = await parseResponse(response)
    saveAuth(data)
    return data
  }, [saveAuth])

  const logout = useCallback(async () => {
    try {
      if (token) await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Local session still needs to be cleared if the backend is unavailable.
    }
    clearSession()
  }, [token, apiFetch, clearSession])

  const value = useMemo(() => ({
    token,
    user,
    loading,
    isAuthenticated: Boolean(token && user),
    apiFetch,
    login,
    bootstrap,
    logout,
    refreshMe,
    clearSession
  }), [token, user, loading, apiFetch, login, bootstrap, logout, refreshMe, clearSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
