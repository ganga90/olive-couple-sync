import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { initCapacitorPlugins } from './lib/capacitor-init'

// Initialize native plugins (StatusBar, Keyboard) — no-ops on web
initCapacitorPlugins();

// Publishable keys are safe to embed in client bundles — they are sent to
// every browser by design. We hardcode a fallback so the app always mounts
// <ClerkProvider>, preventing crashes from components that call Clerk hooks
// directly (DesktopSidebar, NoteDetails, SignIn/SignUp pages, etc.).
// The env var still wins when set, so preview environments can target a
// different Clerk instance.
const FALLBACK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsud2l0aG9saXZlLmFwcCQ'
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY

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
