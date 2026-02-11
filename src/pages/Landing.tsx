import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { NewLandingNav } from "@/components/landing/NewLandingNav";
import { NewLandingHero } from "@/components/landing/NewLandingHero";
import { ChooseYourMode } from "@/components/landing/ChooseYourMode";
import { SuperpowersGrid } from "@/components/landing/SuperpowersGrid";
import { WhatsAppFirst } from "@/components/landing/WhatsAppFirst";
import { BetaTestimonials } from "@/components/landing/BetaTestimonials";
import { NewPricing } from "@/components/landing/NewPricing";
import { NewFooterCTA } from "@/components/landing/NewFooterCTA";
import { NewLandingFooter } from "@/components/landing/NewLandingFooter";

const Landing = () => {
  const { t } = useTranslation('landing');
  
  useSEO({ 
    title: "Olive — Stop Texting Into the Void",
    description: "Your gate codes, grocery lists, and brilliant ideas deserve better than dying in a chat with yourself. Olive organizes everything you text, automatically."
  });

  return (
    <>
      <NewLandingNav />
      <main className="min-h-screen bg-[#EAE8E0]">
        <NewLandingHero />
        <ChooseYourMode />
        <SuperpowersGrid />
        <WhatsAppFirst />
        <BetaTestimonials />
        <NewPricing />
        <NewFooterCTA />
        <NewLandingFooter />
      </main>
    </>
  );
};

export default Landing;
