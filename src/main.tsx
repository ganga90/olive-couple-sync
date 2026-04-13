import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { initCapacitorPlugins } from './lib/capacitor-init'

// Initialize native plugins (StatusBar, Keyboard) — no-ops on web
initCapacitorPlugins();

// Use environment variable for production
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  console.error('[Olive] Missing Clerk Publishable Key — app will load in degraded mode')
}

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