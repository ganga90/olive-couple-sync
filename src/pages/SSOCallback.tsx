import { useEffect, useState } from 'react'
import { useClerk, useAuth } from '@clerk/clerk-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

const SSOCallback = () => {
  const { handleRedirectCallback } = useClerk()
  const { isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('Processing...')

  useEffect(() => {
    const processCallback = async () => {
      try {
        console.log('[SSOCallback] Processing OAuth callback...')
        console.log('[SSOCallback] Current URL:', window.location.href)
        console.log('[SSOCallback] Is Native:', Capacitor.isNativePlatform())
        console.log('[SSOCallback] Search params:', Object.fromEntries(searchParams))

        // Check if this is from a native app request
        const isNativeRequest = searchParams.get('native') === 'true'

        setStatus('Completing authentication...')

        await handleRedirectCallback({
          afterSignInUrl: '/',
          afterSignUpUrl: '/onboarding',
        })

        console.log('[SSOCallback] Callback processed successfully')
        setStatus('Sign in successful!')

        // If this was a native request and we're on web, redirect to native app
        if (isNativeRequest && !Capacitor.isNativePlatform()) {
          console.log('[SSOCallback] Redirecting to native app...')
          setStatus('Returning to app...')
          // The session is now established - redirect to native app
          // The native app will pick up the session from Clerk
          window.location.href = 'olive://auth-complete'
        }
      } catch (error) {
        console.error('[SSOCallback] Error processing callback:', error)
        setStatus('Authentication failed')
        // Navigate to sign-in on error
        setTimeout(() => navigate('/sign-in'), 2000)
      }
    }

    processCallback()
  }, [handleRedirectCallback, navigate, searchParams])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-soft">
      <Loader2 className="h-12 w-12 animate-spin text-olive mb-4" />
      <p className="text-muted-foreground">{status}</p>
    </div>
  )
}

export default SSOCallback
