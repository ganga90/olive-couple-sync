import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { LandingStickyHeader } from "@/components/landing/LandingStickyHeader";
import { LandingHero } from "@/components/landing/LandingHero";
import { ProblemAgitate } from "@/components/landing/ProblemAgitate";
import { ValueStack } from "@/components/landing/ValueStack";
import { SocialProof } from "@/components/landing/SocialProof";
import { Transformation } from "@/components/landing/Transformation";
import { SecondaryCTA } from "@/components/landing/SecondaryCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

const Landing = () => {
  const { t } = useTranslation('landing');
  
  useSEO({ 
    title: t('hero.headline'), 
    description: t('hero.subheadline')
  });

  return (
    <>
      <LandingStickyHeader />
      <main className="min-h-screen bg-[#EAE8E0]">
        <LandingHero />
        <ProblemAgitate />
        <ValueStack />
        <SocialProof />
        <Transformation />
        <SecondaryCTA />
        <LandingFooter />
      </main>
    </>
  );
};

export default Landing;
