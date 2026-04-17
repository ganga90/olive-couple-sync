import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { initCapacitorPlugins } from './lib/capacitor-init'

// Initialize native plugins (StatusBar, Keyboard) — no-ops on web
initCapacitorPlugins();

// Clerk publishable keys are public-safe (shipped to every browser anyway).
// Hardcoded fallback keeps the app functional if VITE_CLERK_PUBLISHABLE_KEY
// isn't injected at build time; the env var still wins so preview/staging
// builds can target a different Clerk instance.
const FALLBACK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsud2l0aG9saXZlLmFwcCQ'
const PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY

createRoot(document.getElementById('root')!).render(
  <ClerkProvider 
    publishableKey={PUBLISHABLE_KEY}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
    waitlistUrl="/request-access"
  >
    <App />
  </ClerkProvider>
)