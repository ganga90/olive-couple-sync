import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { initCapacitorPlugins } from './lib/capacitor-init'

// Initialize native plugins (StatusBar, Keyboard) — no-ops on web
initCapacitorPlugins();

// Clerk publishable keys are public — they're sent to every browser by design,
// so embedding them is safe.
//
// The production instance (pk_live_*) is pinned to witholive.app by Clerk's
// origin policy: any request from a non-witholive.app origin (Lovable preview
// URLs like https://<uuid>.lovableproject.com, localhost, etc.) is rejected
// with HTTP 400 "origin_invalid", which leaves useSignIn() stuck on
// !isLoaded and the login form non-functional.
//
// The development instance (pk_test_*) has no origin restriction, so we use
// it for every non-production host. Production (witholive.app) keeps using
// pk_live. VITE_CLERK_PUBLISHABLE_KEY still wins if set at build time.
const PROD_KEY = 'pk_live_Y2xlcmsud2l0aG9saXZlLmFwcCQ'
const DEV_KEY = 'pk_test_Z3JhdGVmdWwtd3Jlbi04NC5jbGVyay5hY2NvdW50cy5kZXYk'

const isProductionOrigin = () => {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'witholive.app' || host.endsWith('.witholive.app')
}

const FALLBACK_PUBLISHABLE_KEY = isProductionOrigin() ? PROD_KEY : DEV_KEY
const PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY

const root = createRoot(document.getElementById('root')!)

root.render(
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
    waitlistUrl="/request-access"
  >
    <App />
  </ClerkProvider>
)
