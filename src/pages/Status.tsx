import { useAuth } from '../lib/auth'
import { Button } from '../components/ui'

export function PendingApproval() {
  const { profile, signOut, refreshProfile } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow">
        <h1 className="mb-2 text-lg font-semibold">Waiting for approval</h1>
        <p className="mb-5 text-sm text-slate-600">
          Hi {profile?.full_name || profile?.email}, your account is created. Ask the shop Admin to activate it from the
          <b> Users</b> page, then tap “Check again”.
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={refreshProfile}>Check again</Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SetupNeeded() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="max-w-lg rounded-2xl bg-white p-6 shadow">
        <h1 className="mb-2 text-lg font-semibold">Connect Supabase</h1>
        <p className="mb-3 text-sm text-slate-600">
          Create a file named <code className="rounded bg-slate-100 px-1">.env</code> in the project folder (copy
          <code className="rounded bg-slate-100 px-1">.env.example</code>) and fill in:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          VITE_SUPABASE_URL=https://xxxx.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
        </pre>
        <p className="mt-3 text-sm text-slate-600">Then restart <code>npm run dev</code>. See README.md for the full steps.</p>
      </div>
    </div>
  )
}
