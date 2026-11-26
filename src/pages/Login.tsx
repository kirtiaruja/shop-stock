import { useState, type FormEvent } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Button, Field, Input } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        })
        if (error) throw error
        if (!data.session) {
          setInfo('Account created. Check your email to confirm it, then sign in. The admin must also activate your account.')
          setMode('in')
        }
      }
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white">S</div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">StockPilot</h1>
            <p className="text-sm text-slate-500">{mode === 'in' ? 'Sign in to your shop' : 'Create a staff account'}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'up' && (
            <Field label="Your name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          {info && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{info}</p>}
          <Button type="submit" loading={busy} className="w-full py-2.5">
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === 'in' ? 'New staff member?' : 'Already have an account?'}{' '}
          <button className="font-medium text-indigo-600" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
