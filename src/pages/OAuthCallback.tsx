import { useEffect, useState } from 'react'
import { useSignIn, useSignUp } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

const OAuthCallback = () => {
  const { signIn, setActive: setSignInActive } = useSignIn()
  const { signUp, setActive: setSignUpActive } = useSignUp()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Processing authentication...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('[OAuthCallback] Processing OAuth callback...')
        console.log('[OAuthCallback] URL:', window.location.href)

        // Get the search params from the URL
        const params = new URLSearchParams(window.location.search)
        const hash = window.location.hash

        console.log('[OAuthCallback] Search params:', Object.fromEntries(params))
        console.log('[OAuthCallback] Hash:', hash)

        // Try to handle as sign-in first
        if (signIn) {
          const signInAttempt = signIn

          // Check if there's a pending sign-in
          if (signInAttempt.status === 'complete') {
            console.log('[OAuthCallback] Sign-in already complete')
            setStatus('Sign in successful!')
            await setSignInActive({ session: signInAttempt.createdSessionId })
            navigate('/')
            return
          }

          // Try to reload and check status
          try {
            await signInAttempt.reload()
            console.log('[OAuthCallback] Sign-in status after reload:', signInAttempt.status)

            if (signInAttempt.status === 'complete') {
              setStatus('Sign in successful!')
              await setSignInActive({ session: signInAttempt.createdSessionId })
              navigate('/')
              return
            }
          } catch (e) {
            console.log('[OAuthCallback] Sign-in reload error:', e)
          }
        }

        // Try sign-up if sign-in didn't work
        if (signUp) {
          const signUpAttempt = signUp

          if (signUpAttempt.status === 'complete') {
            console.log('[OAuthCallback] Sign-up complete')
            setStatus('Account created!')
            await setSignUpActive({ session: signUpAttempt.createdSessionId })
            navigate('/onboarding')
            return
          }

          try {
            await signUpAttempt.reload()
            console.log('[OAuthCallback] Sign-up status after reload:', signUpAttempt.status)

            if (signUpAttempt.status === 'complete') {
              setStatus('Account created!')
              await setSignUpActive({ session: signUpAttempt.createdSessionId })
              navigate('/onboarding')
              return
            }
          } catch (e) {
            console.log('[OAuthCallback] Sign-up reload error:', e)
          }
        }

        // If we get here, try navigating home and let the auth provider handle it
        console.log('[OAuthCallback] Redirecting to home...')
        setStatus('Completing authentication...')
        setTimeout(() => navigate('/'), 1000)

      } catch (error) {
        console.error('[OAuthCallback] Error:', error)
        setStatus('Authentication failed')
        setTimeout(() => navigate('/sign-in'), 2000)
      }
    }

    handleCallback()
  }, [signIn, signUp, setSignInActive, setSignUpActive, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-soft">
      <Loader2 className="h-12 w-12 animate-spin text-olive mb-4" />
      <p className="text-muted-foreground">{status}</p>
    </div>
  )
}

export default OAuthCallback
