import { useSEO } from "@/hooks/useSEO";
import { HeroSection } from "@/components/landing/HeroSection";
import { InteractivePlayground } from "@/components/landing/InteractivePlayground";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FeatureSections } from "@/components/landing/FeatureSections";
import { ExampleScenarios } from "@/components/landing/ExampleScenarios";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { FloatingActionButton } from "@/components/FloatingActionButton";

const Landing = () => {
  useSEO({ 
    title: "Drop a brain-dump. Olive turns it into next steps.", 
    description: "Type or speak whatever's on your mind—Olive auto-categorizes into lists, assigns owners & dates, and keeps you both in sync. Ask Olive to help with any task." 
  });

  return (
    <main className="min-h-screen bg-background">
      <FloatingActionButton />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        
        <HeroSection />
        <InteractivePlayground />
        <HowItWorks />
        <FeatureSections />
        <ExampleScenarios />
        <PricingSection />
        <FAQSection />

        {/* Footer */}
        <div className="text-center pt-12 pb-8">
          <p className="text-muted-foreground">
            Made with ❤️ for couples who want to stay organized together
          </p>
        </div>
      </div>
    </main>
  );
};

export default Landing;