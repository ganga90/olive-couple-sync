import React, { useState, useEffect } from 'react'
import { useSignIn, useClerk } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Mail, Lock, AlertCircle } from 'lucide-react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

// Google icon component
const GoogleIcon = () => (
  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
)

interface NativeSignInProps {
  redirectUrl?: string
}

export const NativeSignIn: React.FC<NativeSignInProps> = ({ redirectUrl = '/' }) => {
  const { isLoaded, signIn, setActive } = useSignIn()
  const clerk = useClerk()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isOAuthLoading, setIsOAuthLoading] = useState(false)

  // Handle OAuth callback from deep link
  useEffect(() => {
    const handleAppUrlOpen = async ({ url }: { url: string }) => {
      console.log('[NativeSignIn] App URL opened:', url)

      // Check if this is an OAuth callback
      if (url.includes('sso-callback') || url.includes('oauth')) {
        console.log('[NativeSignIn] OAuth callback detected')
        setIsOAuthLoading(true)

        try {
          // Extract the callback path and let Clerk handle it
          const urlObj = new URL(url)
          const callbackPath = urlObj.pathname + urlObj.search + urlObj.hash

          // Navigate to the callback URL so Clerk can process it
          window.location.href = callbackPath
        } catch (err) {
          console.error('[NativeSignIn] OAuth callback error:', err)
          setError('OAuth sign-in failed. Please try again.')
          setIsOAuthLoading(false)
        }
      }
    }

    const listener = CapacitorApp.addListener('appUrlOpen', handleAppUrlOpen)

    return () => {
      listener.then(l => l.remove())
    }
  }, [])

  const handleGoogleSignIn = async () => {
    setIsOAuthLoading(true)
    setError('')

    try {
      const signInUrl = 'https://witholive.app/sign-in?native=true'
      console.log('[NativeSignIn] Opening web sign-in page in EXTERNAL browser:', signInUrl)

      if (Capacitor.isNativePlatform()) {
        // Use native linking to open in EXTERNAL Safari (not in-app browser)
        // Create a hidden anchor with target="_blank" and click it
        // This bypasses Capacitor's interception and opens actual Safari
        const link = document.createElement('a')
        link.href = signInUrl
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        // Add to DOM temporarily, click, and remove
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } else {
        // On web, just open in new tab
        window.open(signInUrl, '_blank')
      }

      // The browser will handle OAuth, then redirect to olive://auth-complete
      // Reset loading state after a delay (in case user cancels)
      setTimeout(() => setIsOAuthLoading(false), 5000)
    } catch (err: any) {
      console.error('[NativeSignIn] Browser open error:', err)
      setError('Could not open sign-in page. Please try again.')
      setIsOAuthLoading(false)
    }
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !signIn) return

    setIsLoading(true)
    setError('')

    try {
      console.log('[NativeSignIn] Attempting sign in...')

      const result = await signIn.create({
        identifier: email,
        password,
      })

      console.log('[NativeSignIn] Sign in result:', result.status)

      if (result.status === 'complete') {
        console.log('[NativeSignIn] Sign in complete, setting active session...')
        await setActive({ session: result.createdSessionId })
        navigate(redirectUrl)
      } else {
        // Handle additional steps if needed (2FA, etc.)
        console.log('[NativeSignIn] Additional steps required:', result)
        setError('Additional verification required. Please try again.')
      }
    } catch (err: any) {
      console.error('[NativeSignIn] Error:', err)
      const errorMessage = err?.errors?.[0]?.longMessage ||
                          err?.errors?.[0]?.message ||
                          err?.message ||
                          'Invalid email or password'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-olive" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Google OAuth Button */}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isOAuthLoading || isLoading}
      >
        {isOAuthLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing in with Google...
          </>
        ) : (
          <>
            <GoogleIcon />
            Continue with Google
          </>
        )}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <form onSubmit={handleSignIn} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9"
              required
            />
          </div>
        </div>

        <Button
          type="submit"
          className="w-full bg-olive hover:bg-olive-dark"
          disabled={isLoading || isOAuthLoading || !email || !password}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            'Sign in with email'
          )}
        </Button>
      </form>
    </div>
  )
}

export default NativeSignIn
