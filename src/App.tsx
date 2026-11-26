import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth, usePermissions } from './lib/auth'
import { supabaseConfigured } from './lib/supabase'
import { Spinner, ToastProvider } from './components/ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import { PendingApproval, SetupNeeded } from './pages/Status'
import Dashboard from './pages/Dashboard'
import NewSale from './pages/NewSale'

// less-used screens load on demand to keep the first load fast on phones
const Sales = lazy(() => import('./pages/Sales'))
const NewPurchase = lazy(() => import('./pages/NewPurchase'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Products = lazy(() => import('./pages/Products'))
const Customers = lazy(() => import('./pages/Customers'))
const Users = lazy(() => import('./pages/Users'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Dues = lazy(() => import('./pages/Dues'))
const Payments = lazy(() => import('./pages/Payments'))

function Guard({ need, children }: { need: 'manager' | 'admin'; children: ReactNode }) {
  const { isManager, isAdmin } = usePermissions()
  const ok = need === 'admin' ? isAdmin : isManager
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

function Shell() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Login />
  if (!profile) return <Spinner label="Loading your account…" />
  if (!profile.active) return <PendingApproval />

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="sale/new" element={<NewSale />} />
          <Route path="sales" element={<Sales />} />
          <Route path="products" element={<Products />} />
          <Route path="customers" element={<Customers />} />
          <Route path="dues" element={<Dues />} />
          <Route path="payments" element={<Payments />} />
          <Route path="suppliers" element={<Guard need="manager"><Suppliers /></Guard>} />
          <Route path="purchase/new" element={<Guard need="manager"><NewPurchase /></Guard>} />
          <Route path="purchases" element={<Guard need="manager"><Purchases /></Guard>} />
          <Route path="users" element={<Guard need="admin"><Users /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  if (!supabaseConfigured) return <SetupNeeded />
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
