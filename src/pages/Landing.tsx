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
    title: "Olive – The AI Chief of Staff for Couples & Co-Founders",
    description: "Stop nagging. Stop forgetting. Olive listens to your WhatsApp voice notes, receipts, and links, and organizes them instantly."
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
