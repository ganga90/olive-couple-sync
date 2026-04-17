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
  console.error('[Olive] Missing Clerk Publishable Key — rendering app without auth (public pages only)')
}

const root = createRoot(document.getElementById('root')!)

if (PUBLISHABLE_KEY) {
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
} else {
  // Degraded mode: render app without Clerk so public routes (landing, legal) still work.
  // AuthProvider handles the missing Clerk context and falls back to unauthenticated state.
  root.render(<App />)
}