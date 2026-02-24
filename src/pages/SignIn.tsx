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
import { Loader2, Mail, KeyRound, ArrowLeft, Lock, Sparkles, Eye, EyeOff, Fingerprint } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type SignInMethod = "email_code" | "password";

const SignInPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";
  const isNative = Capacitor.isNativePlatform();
  const isNativeRequest = searchParams.get("native") === "true";
  const { isSignedIn } = useAuth();
  const { signIn, isLoaded, setActive } = useSignIn();
  const navigate = useLocalizedNavigate();
  const rawNavigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [method, setMethod] = useState<SignInMethod>("email_code");

  useSEO({ title: `${t('signIn.title')} — Olive`, description: t('signIn.description') });

  // If this page was opened from native app and user is now signed in,
  // redirect back to the native app
  useEffect(() => {
    if (isNativeRequest && isSignedIn && !isNative) {
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

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    try {
      const result = await signIn.create({
        strategy: "password",
        identifier: email,
        password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        const effectiveRedirectUrl = isNativeRequest ? '/auth-redirect-native' : redirectUrl;
        navigate(effectiveRedirectUrl);
      } else {
        toast.error(t('signIn.verificationIncomplete', 'Verification incomplete. Please try again.'));
      }
    } catch (err: any) {
      console.error('[SignIn] Error signing in with password:', err);
      const errorMessage = err?.errors?.[0]?.longMessage || err?.message || t('signIn.errorPassword', 'Invalid email or password');
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
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        const effectiveRedirectUrl = isNativeRequest ? '/auth-redirect-native' : redirectUrl;
        navigate(effectiveRedirectUrl);
      } else {
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

  const handleNavigateBack = () => {
    if (window.history.length > 1) {
      rawNavigate(-1);
    } else {
      navigate('/');
    }
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

  const switchMethod = (newMethod: SignInMethod) => {
    setMethod(newMethod);
    setPassword("");
    setCode("");
    setPendingVerification(false);
  };

  const handlePasskeySignIn = async () => {
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    try {
      const result = await (signIn as any).authenticateWithPasskey({ flow: 'discoverable' });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        const effectiveRedirectUrl = isNativeRequest ? '/auth-redirect-native' : redirectUrl;
        setTimeout(() => navigate(effectiveRedirectUrl), 300);
      } else {
        toast.error(t('signIn.verificationIncomplete', 'Verification incomplete. Please try again.'));
      }
    } catch (err: any) {
      console.error('[SignIn] Passkey error:', err);
      const clerkError = err?.errors?.[0];
      // If passkeys not supported or user cancelled
      if (clerkError?.code === 'passkey_not_supported') {
        toast.error(t('signIn.passkeyNotSupported', 'Passkeys are not supported on this device.'));
      } else if (err?.name === 'NotAllowedError' || clerkError?.code === 'passkey_registration_required') {
        // No passkey found — prompt user to sign in first, then create one
        toast(t('signIn.passkeyNotFound', "No passkey found for this device. Sign in with email first, then create a passkey from your Profile settings."), {
          duration: 6000,
          icon: '🔑',
        });
      } else {
        toast.error(clerkError?.longMessage || t('signIn.passkeyError', 'Passkey sign-in failed. Try another method.'));
      }
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
        {/* Back navigation */}
        <button
          type="button"
          onClick={handleNavigateBack}
          className="flex items-center gap-1 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('signIn.backNav', 'Back')}
        </button>

        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold text-olive-dark">{t('signIn.title')}</h1>
        <p className="mb-6 text-center text-muted-foreground">{t('signIn.description')}</p>

        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft overflow-hidden">
          <AnimatePresence mode="wait">
            {!pendingVerification ? (
              <motion.div
                key={method}
                initial={{ opacity: 0, x: method === "password" ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: method === "password" ? -20 : 20 }}
                transition={{ duration: 0.2 }}
              >
                {/* Method Toggle Tabs */}
                <div className="flex rounded-lg bg-muted p-1 mb-5">
                  <button
                    type="button"
                    onClick={() => switchMethod("email_code")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-all",
                      method === "email_code"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t('signIn.methodCode', 'Email code')}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMethod("password")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-all",
                      method === "password"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Lock className="h-4 w-4" />
                    {t('signIn.methodPassword', 'Password')}
                  </button>
                </div>

                {method === "email_code" ? (
                  /* Email Code Method */
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
                        inputMode="email"
                        name="email"
                        className="bg-background text-base"
                      />
                    </div>

                    <Button
                      type="submit"
                      variant="default"
                      size="lg"
                      className="w-full"
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
                        onClick={() => navigate('/request-access')}
                        className="text-primary hover:underline font-medium"
                      >
                        {t('signIn.requestAccess', 'Request beta access')}
                      </button>
                    </p>
                  </form>
                ) : (
                  /* Password Method */
                  <form onSubmit={handlePasswordSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email-pw" className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        {t('signIn.emailLabel', 'Email address')}
                      </Label>
                      <Input
                        id="email-pw"
                        type="email"
                        placeholder={t('signIn.emailPlaceholder', 'you@example.com')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        inputMode="email"
                        name="email"
                        className="bg-background text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password" className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        {t('signIn.passwordLabel', 'Password')}
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder={t('signIn.passwordPlaceholder', 'Enter your password')}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          className="bg-background text-base pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showPassword ? t('signIn.hidePassword', 'Hide password') : t('signIn.showPassword', 'Show password')}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      variant="default"
                      size="lg"
                      className="w-full"
                      disabled={isLoading || !email || !password}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('signIn.signingIn', 'Signing in...')}
                        </>
                      ) : (
                        t('signIn.signInButton', 'Sign in')
                      )}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                      {t('signIn.noAccount', "Don't have an account?")}{' '}
                      <button
                        type="button"
                        onClick={() => navigate('/request-access')}
                        className="text-primary hover:underline font-medium"
                      >
                        {t('signIn.requestAccess', 'Request beta access')}
                      </button>
                    </p>
                  </form>
                )}
              </motion.div>
            ) : (
              /* Step 2: Enter verification code */
              <motion.form
                key="verify"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleVerifyCode}
                className="space-y-4"
              >
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
                  variant="default"
                  size="lg"
                  className="w-full"
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
              </motion.form>
            )}
          </AnimatePresence>

          {/* Passkey sign-in option */}
          {!pendingVerification && (
            <>
              <div className="flex items-center gap-3 my-4">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">{t('signIn.or', 'or')}</span>
                <Separator className="flex-1" />
              </div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={handlePasskeySignIn}
                disabled={isLoading}
              >
                <Fingerprint className="mr-2 h-4 w-4" />
                {t('signIn.passkeyButton', 'Sign in with passkey')}
              </Button>
            </>
          )}

          <LegalConsentText className="mt-4 px-2" />
        </Card>
      </section>
    </main>
  );
};

export default SignInPage;
