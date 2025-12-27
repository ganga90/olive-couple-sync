import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

export const HeroSection = () => {
  const { t } = useTranslation('landing');
  const { getLocalizedPath } = useLocalizedNavigate();
  const navigate = useNavigate();

  const scrollToDemo = () => {
    document.getElementById('demo-playground')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="text-center space-y-8 mb-16">
      <div className="flex justify-center mb-8">
        <OliveLogoWithText size="lg" className="justify-center scale-125" />
      </div>
      
      <div className="space-y-6">
        <h1 className="text-4xl md:text-6xl font-bold text-gray-900 leading-tight">
          {t('hero.title').split('.')[0]}.
          <span className="block text-olive">{t('hero.title').split('.')[1] || ''}</span>
        </h1>
        
        <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
          {t('hero.description')}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto">
        <Button 
          size="lg" 
          onClick={() => navigate(getLocalizedPath("/sign-up"))}
          className="w-full sm:w-auto bg-olive hover:bg-olive/90 text-white shadow-lg text-lg px-8 py-6"
        >
          {t('cta.getStarted')}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        
        <Button 
          size="lg" 
          variant="outline" 
          onClick={scrollToDemo}
          className="w-full sm:w-auto border-[hsl(var(--ai-accent))]/30 text-[hsl(var(--ai-accent))] hover:bg-[hsl(var(--ai-accent))]/10 text-lg px-8 py-6 font-semibold"
        >
          <Play className="mr-2 h-5 w-5 fill-[hsl(var(--ai-accent))]/20" />
          {t('cta.seeHowItWorks')}
        </Button>
      </div>
    </section>
  );
};
