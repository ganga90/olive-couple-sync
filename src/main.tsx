import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'

const PUBLISHABLE_KEY = 'pk_test_Z3JhdGVmdWwtd3Jlbi04NC5jbGVyay5hY2NvdW50cy5kZXYk'
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key')
}


createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
)
