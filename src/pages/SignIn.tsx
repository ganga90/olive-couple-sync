import { SignIn, useAuth } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { LegalConsentText } from "@/components/LegalConsentText";
import { useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";

const SignInPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";
  const isNative = Capacitor.isNativePlatform();
  const isNativeRequest = searchParams.get("native") === "true";
  const { isSignedIn } = useAuth();
  
  useSEO({ title: `${t('signIn.title')} — Olive`, description: t('signIn.description') });

  // If this page was opened from native app and user is now signed in,
  // redirect back to the native app
  useEffect(() => {
    if (isNativeRequest && isSignedIn && !isNative) {
      console.log('[SignIn] User signed in from native request, redirecting to app...');
      window.location.href = 'olive://auth-complete';
    }
  }, [isNativeRequest, isSignedIn, isNative]);

  // For native requests on web, use Clerk's component (handles OAuth properly)
  // and set up redirect back to native app after auth
  const effectiveRedirectUrl = isNativeRequest ? '/auth-redirect-native' : redirectUrl;

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
        
        <Card className="p-4 bg-white/50 border-olive/20 shadow-soft">
          <SignIn fallbackRedirectUrl={effectiveRedirectUrl} />
          <LegalConsentText className="mt-4 px-2" />
        </Card>
      </section>
    </main>
  );
};

export default SignInPage;
