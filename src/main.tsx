import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'

// Use environment variable for production
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key - Please set VITE_CLERK_PUBLISHABLE_KEY')
}

console.log('[Olive] Initializing Clerk with key:', PUBLISHABLE_KEY.substring(0, 20) + '...')

createRoot(document.getElementById('root')!).render(
  <ClerkProvider 
    publishableKey={PUBLISHABLE_KEY}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
  >
    <App />
  </ClerkProvider>
)