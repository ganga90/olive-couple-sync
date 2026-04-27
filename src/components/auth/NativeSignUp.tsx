import React, { useState } from 'react'
import { useSignUp } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Mail, Lock, User, AlertCircle, CheckCircle2 } from 'lucide-react'

interface NativeSignUpProps {
  redirectUrl?: string
}

export const NativeSignUp: React.FC<NativeSignUpProps> = ({ redirectUrl = '/' }) => {
  const { isLoaded, signUp, setActive } = useSignUp()
  const navigate = useNavigate()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingVerification, setPendingVerification] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Handle initial sign up
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !signUp) return

    setIsLoading(true)
    setError('')

    try {
      console.log('[NativeSignUp] Starting sign up...')

      // Create the sign up
      await signUp.create({
        firstName,
        lastName,
        emailAddress: email,
        password,
      })

      console.log('[NativeSignUp] Sign up created, preparing verification...')

      // Send email verification code
      await signUp.prepareEmailAddressVerification({
        strategy: 'email_code',
      })

      console.log('[NativeSignUp] Verification email sent')
      setPendingVerification(true)
    } catch (err: any) {
      console.error('[NativeSignUp] Error:', err)
      const errorMessage = err?.errors?.[0]?.longMessage ||
                          err?.errors?.[0]?.message ||
                          err?.message ||
                          'An error occurred during sign up'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle verification code submission
  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isLoaded || !signUp) return

    setIsLoading(true)
    setError('')

    try {
      console.log('[NativeSignUp] Attempting verification...')

      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      })

      console.log('[NativeSignUp] Verification result:', result.status)

      if (result.status === 'complete') {
        console.log('[NativeSignUp] Sign up complete, setting active session...')
        await setActive({ session: result.createdSessionId })
        navigate(redirectUrl)
      } else {
        console.log('[NativeSignUp] Additional steps required:', result)
        setError('Verification incomplete. Please try again.')
      }
    } catch (err: any) {
      console.error('[NativeSignUp] Verification error:', err)
      const errorMessage = err?.errors?.[0]?.longMessage ||
                          err?.errors?.[0]?.message ||
                          err?.message ||
                          'Invalid verification code'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Resend verification code
  const handleResendCode = async () => {
    if (!isLoaded || !signUp) return

    setIsLoading(true)
    setError('')

    try {
      await signUp.prepareEmailAddressVerification({
        strategy: 'email_code',
      })
      setError('') // Clear any previous errors
    } catch (err: any) {
      console.error('[NativeSignUp] Resend error:', err)
      setError('Failed to resend code. Please try again.')
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

  // Verification code form
  if (pendingVerification) {
    return (
      <form onSubmit={handleVerification} className="space-y-4">
        <div className="text-center mb-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-olive/10 mb-3">
            <Mail className="h-6 w-6 text-olive" />
          </div>
          <h3 className="font-semibold text-lg">Check your email</h3>
          <p className="text-sm text-muted-foreground mt-1">
            We sent a verification code to <strong>{email}</strong>
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="code">Verification Code</Label>
          <Input
            id="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Enter 6-digit code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            className="text-center text-lg tracking-widest"
            maxLength={6}
            required
          />
        </div>

        <Button
          type="submit"
          className="w-full bg-olive hover:bg-olive-dark"
          disabled={isLoading || verificationCode.length < 6}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Verify Email
            </>
          )}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={isLoading}
            className="text-sm text-olive hover:underline disabled:opacity-50"
          >
            Didn't receive a code? Resend
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              setPendingVerification(false)
              setVerificationCode('')
              setError('')
            }}
            className="text-sm text-muted-foreground hover:underline"
          >
            Use a different email
          </button>
        </div>
      </form>
    )
  }

  // Initial sign up form
  return (
    <form onSubmit={handleSignUp} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="firstName"
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            type="text"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>

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
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9"
            minLength={8}
            required
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Must be at least 8 characters
        </p>
      </div>

      <Button
        type="submit"
        className="w-full bg-olive hover:bg-olive-dark"
        disabled={isLoading || !email || !password}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating account...
          </>
        ) : (
          'Continue'
        )}
      </Button>
    </form>
  )
}

export default NativeSignUp
