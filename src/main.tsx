import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Number boxes: tapping in selects the whole number, so typing replaces it (no "010"),
// and the mouse wheel never changes a number by accident.
document.addEventListener('focusin', (e) => {
  const el = e.target
  if (el instanceof HTMLInputElement && el.type === 'number') {
    const before = el.value
    setTimeout(() => {
      if (el.value === before) el.select() // not if a digit was already typed
    }, 0)
  }
})
document.addEventListener(
  'wheel',
  () => {
    const el = document.activeElement
    if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
  },
  { passive: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
