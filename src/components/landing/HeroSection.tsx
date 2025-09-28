import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OliveLogoWithText } from "@/components/OliveLogo";

export const HeroSection = () => {
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
          Drop a brain-dump.
          <span className="block text-olive">Olive turns it into next steps.</span>
        </h1>
        
        <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
          Type or speak whatever's on your mind—Olive auto-categorizes into lists, 
          assigns owners & dates, and keeps you both in sync. Ask Olive to help with any task.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto">
        <Button 
          size="lg" 
          onClick={() => navigate("/sign-up")}
          className="w-full sm:w-auto bg-olive hover:bg-olive/90 text-white shadow-lg text-lg px-8 py-6"
        >
          Try it free
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        
        <Button 
          size="lg" 
          variant="outline" 
          onClick={scrollToDemo}
          className="w-full sm:w-auto border-gray-300 text-gray-700 hover:bg-gray-50 text-lg px-8 py-6"
        >
          <Play className="mr-2 h-5 w-5" />
          See it in action
        </Button>
      </div>
    </section>
  );
};