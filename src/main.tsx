import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'

// Use your new Clerk publishable key directly (safe to expose since it's public)
const PUBLISHABLE_KEY = 'your-new-publishable-key-here'

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key')
}

console.log('[Olive] Initializing Clerk with key:', PUBLISHABLE_KEY.substring(0, 20) + '...')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
)