import { useSignIn, useAuth } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { LegalConsentText } from "@/components/LegalConsentText";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

const SignInPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";
  const isNative = Capacitor.isNativePlatform();
  const isNativeRequest = searchParams.get("native") === "true";
  const { isSignedIn } = useAuth();
  const { signIn, isLoaded, setActive } = useSignIn();
  const navigate = useLocalizedNavigate();
  
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  
  useSEO({ title: `${t('signIn.title')} — Olive`, description: t('signIn.description') });

  // If this page was opened from native app and user is now signed in,
  // redirect back to the native app
  useEffect(() => {
    if (isNativeRequest && isSignedIn && !isNative) {
      console.log('[SignIn] User signed in from native request, redirecting to app...');
      window.location.href = 'olive://auth-complete';
    }
  }, [isNativeRequest, isSignedIn, isNative]);

  // Redirect if already signed in
  useEffect(() => {
    if (isSignedIn && !isNativeRequest) {
      navigate(redirectUrl);
    }
  }, [isSignedIn, isNativeRequest, navigate, redirectUrl]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    try {
      // Start the sign-in process with email code
      await signIn.create({
        strategy: "email_code",
        identifier: email,
      });
      
      setPendingVerification(true);
      toast.success(t('signIn.codeSent', 'Verification code sent to your email!'));
    } catch (err: any) {
      console.error('[SignIn] Error sending code:', err);
      const errorMessage = err?.errors?.[0]?.longMessage || err?.message || t('signIn.errorSendingCode', 'Failed to send verification code');
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    try {
      // Attempt to verify the code
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });

      if (result.status === "complete") {
        // Set the active session
        await setActive({ session: result.createdSessionId });
        
        // Handle redirect
        const effectiveRedirectUrl = isNativeRequest ? '/auth-redirect-native' : redirectUrl;
        navigate(effectiveRedirectUrl);
      } else {
        console.log('[SignIn] Sign in not complete:', result);
        toast.error(t('signIn.verificationIncomplete', 'Verification incomplete. Please try again.'));
      }
    } catch (err: any) {
      console.error('[SignIn] Error verifying code:', err);
      const errorMessage = err?.errors?.[0]?.longMessage || err?.message || t('signIn.invalidCode', 'Invalid verification code');
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setPendingVerification(false);
    setCode("");
  };

  const handleResendCode = async () => {
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    try {
      await signIn.create({
        strategy: "email_code",
        identifier: email,
      });
      toast.success(t('signIn.codeResent', 'New code sent!'));
    } catch (err: any) {
      console.error('[SignIn] Error resending code:', err);
      toast.error(t('signIn.errorResendingCode', 'Failed to resend code'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>
        
        <h1 className="mb-2 text-center text-3xl font-bold text-olive-dark">{t('signIn.title')}</h1>
        <p className="mb-6 text-center text-muted-foreground">{t('signIn.description')}</p>
        
        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft">
          {!pendingVerification ? (
            // Step 1: Enter email
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t('signIn.emailLabel', 'Email address')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('signIn.emailPlaceholder', 'you@example.com')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="bg-background"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-gradient-olive hover:bg-olive text-white shadow-olive"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('signIn.sendingCode', 'Sending code...')}
                  </>
                ) : (
                  t('signIn.sendCode', 'Send verification code')
                )}
              </Button>
              
              <p className="text-center text-sm text-muted-foreground">
                {t('signIn.noAccount', "Don't have an account?")}{' '}
                <button 
                  type="button"
                  onClick={() => navigate('/sign-up')}
                  className="text-primary hover:underline font-medium"
                >
                  {t('signIn.signUpLink', 'Sign up')}
                </button>
              </p>
            </form>
          ) : (
            // Step 2: Enter verification code
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('signIn.back', 'Back')}
              </button>
              
              <div className="text-center py-2">
                <p className="text-sm text-muted-foreground">
                  {t('signIn.codeSentTo', 'We sent a code to')}
                </p>
                <p className="font-medium text-foreground">{email}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="code" className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  {t('signIn.codeLabel', 'Verification code')}
                </Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  placeholder={t('signIn.codePlaceholder', 'Enter 6-digit code')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="one-time-code"
                  className="bg-background text-center text-lg tracking-widest"
                  maxLength={6}
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-gradient-olive hover:bg-olive text-white shadow-olive"
                disabled={isLoading || code.length < 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('signIn.verifying', 'Verifying...')}
                  </>
                ) : (
                  t('signIn.verify', 'Verify and sign in')
                )}
              </Button>
              
              <p className="text-center text-sm text-muted-foreground">
                {t('signIn.didntReceive', "Didn't receive the code?")}{' '}
                <button 
                  type="button"
                  onClick={handleResendCode}
                  disabled={isLoading}
                  className="text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {t('signIn.resend', 'Resend')}
                </button>
              </p>
            </form>
          )}
          
          <LegalConsentText className="mt-4 px-2" />
        </Card>
      </section>
    </main>
  );
};

export default SignInPage;
