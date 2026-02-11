import { useSignUp, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { LegalConsentText } from "@/components/LegalConsentText";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, User, Mail, KeyRound, ArrowLeft, ArrowRight, Check, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type Step = "name" | "email" | "verify";

const SignUpPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/onboarding";
  const navigate = useLocalizedNavigate();
  const rawNavigate = useNavigate();
  const { signUp, isLoaded, setActive } = useSignUp();
  const { isSignedIn } = useClerkAuth();
  
  const [step, setStep] = useState<Step>("name");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  useSEO({ title: `${t('signUp.title')} — Olive`, description: t('signUp.description') });

  // Redirect if already signed in
  useEffect(() => {
    if (isSignedIn) {
      navigate(redirectUrl, { replace: true });
    }
  }, [isSignedIn, navigate, redirectUrl]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      toast.error(t('signUp.nameRequired', 'Please enter your first name'));
      return;
    }
    setStep("email");
  };

  const completeSignUp = async (result: any) => {
    if (result.status === "complete") {
      if (result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
      }
      toast.success(t('signUp.accountCreated', 'Account created successfully!'));
      // Small delay to let Clerk session propagate
      setTimeout(() => navigate(redirectUrl), 300);
      return true;
    }
    return false;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    try {
      await signUp.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email,
        password,
      });

      // Check if sign-up is already complete (e.g. user already verified)
      if (await completeSignUp(signUp)) return;

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      
      setStep("verify");
      toast.success(t('signUp.codeSent', 'Verification code sent to your email!'));
    } catch (err: any) {
      console.error('[SignUp] Error:', err);
      const clerkError = err?.errors?.[0];
      const errorCode = clerkError?.code;
      
      // If user already exists, redirect to sign-in
      if (errorCode === 'form_identifier_exists') {
        toast.error(t('signUp.emailExists', 'This email is already registered. Please sign in instead.'));
        navigate('/sign-in');
        return;
      }
      
      const errorMessage = clerkError?.longMessage || err?.message || t('signUp.errorSendingCode', 'Failed to send verification code');
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });

      console.log('[SignUp] Verification result:', JSON.stringify({
        status: result.status,
        createdSessionId: result.createdSessionId,
        createdUserId: result.createdUserId,
        missingFields: result.missingFields,
        unverifiedFields: result.unverifiedFields,
        verifications: result.verifications,
      }, null, 2));

      if (await completeSignUp(result)) return;

      // Handle "missing_requirements" — email verified but sign-up needs session activation
      // This happens when Clerk considers sign-up done but hasn't created a session yet
      if (result.status === 'missing_requirements') {
        // Check if email is now verified — if so, the sign-up is essentially done
        const emailVerified = (result as any).verifications?.emailAddress?.status === 'verified';
        if (emailVerified && result.createdSessionId) {
          await setActive({ session: result.createdSessionId });
          toast.success(t('signUp.accountCreated', 'Account created successfully!'));
          setTimeout(() => navigate(redirectUrl), 300);
          return;
        }
        // If there are unverified fields we can't handle, log and show message
        console.log('[SignUp] Missing requirements:', result.missingFields, result.unverifiedFields);
      }

      toast.error(t('signUp.verificationIncomplete', 'Verification incomplete. Please try again.'));
    } catch (err: any) {
      console.error('[SignUp] Error verifying code:', err);
      const clerkError = err?.errors?.[0];
      const errorCode = clerkError?.code;

      // Handle "already verified" - try to complete the sign-up
      if (errorCode === 'verification_already_verified' || 
          (errorCode === 'form_code_incorrect' && signUp.status === 'complete')) {
        if (await completeSignUp(signUp)) return;
      }

      const errorMessage = clerkError?.longMessage || err?.message || t('signUp.invalidCode', 'Invalid verification code');
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    try {
      // If sign-up is already complete, just activate the session
      if (signUp.status === 'complete') {
        if (await completeSignUp(signUp)) return;
      }

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      toast.success(t('signUp.codeResent', 'New code sent!'));
    } catch (err: any) {
      console.error('[SignUp] Error resending code:', err);
      const clerkError = err?.errors?.[0];
      
      // If already verified, complete the sign-up
      if (clerkError?.code === 'verification_already_verified') {
        if (await completeSignUp(signUp)) return;
      }
      
      toast.error(clerkError?.longMessage || t('signUp.errorResendingCode', 'Failed to resend code'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "name") {
      // On first step, navigate back to previous page
      if (window.history.length > 1) {
        rawNavigate(-1);
      } else {
        navigate('/');
      }
    } else if (step === "email") {
      setStep("name");
    } else if (step === "verify") {
      setStep("email");
      setCode("");
    }
  };

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  const steps: Step[] = ["name", "email", "verify"];
  const currentStepIndex = steps.indexOf(step);

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        {/* Back navigation */}
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('signUp.back', 'Back')}
        </button>

        {/* Logo */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>
        
        <h1 className="mb-2 text-center text-3xl font-bold text-foreground">{t('signUp.title')}</h1>
        <p className="mb-4 text-center text-muted-foreground">{t('signUp.description')}</p>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                i < currentStepIndex 
                  ? "bg-primary text-primary-foreground" 
                  : i === currentStepIndex 
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20" 
                    : "bg-muted text-muted-foreground"
              )}>
                {i < currentStepIndex ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={cn(
                  "w-8 h-0.5 mx-1",
                  i < currentStepIndex ? "bg-primary" : "bg-muted"
                )} />
              )}
            </div>
          ))}
        </div>
        
        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft overflow-hidden">
          <AnimatePresence mode="wait">
            {step === "name" && (
              <motion.form
                key="name"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleNameSubmit}
                className="space-y-4"
              >
                <div className="text-center py-2">
                  <User className="h-10 w-10 text-primary mx-auto mb-2" />
                  <h2 className="text-lg font-semibold">{t('signUp.whatsYourName', "What's your name?")}</h2>
                  <p className="text-sm text-muted-foreground">{t('signUp.nameHint', "So we can personalize your experience")}</p>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">{t('signUp.firstName', 'First name')}</Label>
                    <Input
                      id="firstName"
                      type="text"
                      placeholder={t('signUp.firstNamePlaceholder', 'Your first name')}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      autoComplete="given-name"
                      autoFocus
                      className="bg-background text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">{t('signUp.lastName', 'Last name')} <span className="text-muted-foreground">({t('signUp.optional', 'optional')})</span></Label>
                    <Input
                      id="lastName"
                      type="text"
                      placeholder={t('signUp.lastNamePlaceholder', 'Your last name')}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                      className="bg-background text-base"
                    />
                  </div>
                </div>
                
                <Button 
                  type="submit" 
                  variant="default"
                  size="lg"
                  className="w-full"
                  disabled={!firstName.trim()}
                >
                  {t('signUp.continue', 'Continue')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  {t('signUp.hasAccount', "Already have an account?")}{' '}
                  <button 
                    type="button"
                    onClick={() => navigate('/sign-in')}
                    className="text-primary hover:underline font-medium"
                  >
                    {t('signUp.signInLink', 'Sign in')}
                  </button>
                </p>
              </motion.form>
            )}

            {step === "email" && (
              <motion.form
                key="email"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleEmailSubmit}
                className="space-y-4"
              >
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('signUp.back', 'Back')}
                </button>

                <div className="text-center py-2">
                  <Mail className="h-10 w-10 text-primary mx-auto mb-2" />
                  <h2 className="text-lg font-semibold">{t('signUp.whatsYourEmail', "What's your email?")}</h2>
                  <p className="text-sm text-muted-foreground">{t('signUp.emailHint', "We'll send you a verification code")}</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">{t('signUp.emailLabel', 'Email address')}</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    placeholder={t('signUp.emailPlaceholder', 'you@example.com')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                    className="bg-background text-base"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t('signUp.passwordLabel', 'Create a password')}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={t('signUp.passwordPlaceholder', 'Choose a secure password')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="bg-background text-base pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
                      {t('signUp.sendingCode', 'Sending code...')}
                    </>
                  ) : (
                    <>
                      {t('signUp.sendCode', 'Send verification code')}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </motion.form>
            )}

            {step === "verify" && (
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
                  {t('signUp.back', 'Back')}
                </button>

                <div className="text-center py-2">
                  <KeyRound className="h-10 w-10 text-primary mx-auto mb-2" />
                  <h2 className="text-lg font-semibold">{t('signUp.checkYourEmail', 'Check your email')}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('signUp.codeSentTo', 'We sent a code to')}
                  </p>
                  <p className="font-medium text-foreground">{email}</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="code">{t('signUp.codeLabel', 'Verification code')}</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    placeholder={t('signUp.codePlaceholder', 'Enter 6-digit code')}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    autoComplete="one-time-code"
                    autoFocus
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
                      {t('signUp.verifying', 'Creating account...')}
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      {t('signUp.createAccount', 'Create my account')}
                    </>
                  )}
                </Button>
                
                <p className="text-center text-sm text-muted-foreground">
                  {t('signUp.didntReceive', "Didn't receive the code?")}{' '}
                  <button 
                    type="button"
                    onClick={handleResendCode}
                    disabled={isLoading}
                    className="text-primary hover:underline font-medium disabled:opacity-50"
                  >
                    {t('signUp.resend', 'Resend')}
                  </button>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
          
          <LegalConsentText className="mt-4 px-2" />
        </Card>
      </section>
    </main>
  );
};

export default SignUpPage;
