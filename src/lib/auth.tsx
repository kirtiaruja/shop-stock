/* eslint-disable react-refresh/only-export-components */
import { clearAllDrafts } from './draft'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile, type Role } from './supabase'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile((data as Profile) ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // defer to avoid calling supabase inside the auth callback
      setTimeout(() => loadProfile(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const value: AuthState = {
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      clearAllDrafts()
      await supabase.auth.signOut()
      setProfile(null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export const roleLabel: Record<Role, string> = {
  admin: 'Admin',
  co_admin: 'Co-admin',
  salesman: 'Salesman',
}

export function usePermissions() {
  const { profile } = useAuth()
  const role = profile?.active ? profile.role : null
  return {
    role,
    isAdmin: role === 'admin',
    isManager: role === 'admin' || role === 'co_admin',
    isStaff: role !== null,
  }
}
