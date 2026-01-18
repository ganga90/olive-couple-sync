import { SignUp } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { LegalConsentText } from "@/components/LegalConsentText";
import { useSearchParams } from "react-router-dom";

const SignUpPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";
  
  useSEO({ title: `${t('signUp.title')} — Olive`, description: t('signUp.description') });

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>
        
        <h1 className="mb-2 text-center text-3xl font-bold text-olive-dark">{t('signUp.title')}</h1>
        <p className="mb-6 text-center text-muted-foreground">{t('signUp.description')}</p>
        
        <Card className="p-4 bg-white/50 border-olive/20 shadow-soft">
          <SignUp fallbackRedirectUrl={redirectUrl} />
          <LegalConsentText className="mt-4 px-2" />
        </Card>
      </section>
    </main>
  );
};

export default SignUpPage;
