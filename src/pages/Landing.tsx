import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Users, MessageSquare, Sparkles, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogoWithText } from "@/components/OliveLogo";

const Landing = () => {
  useSEO({ 
    title: "Olive — The Smart Organizer for Couples", 
    description: "Transform your shared life with AI-powered note organization. Perfect for couples managing daily tasks, plans, and memories together." 
  });

  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-gradient-to-br from-olive-50 via-white to-emerald-50">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        
        {/* Hero Section */}
        <div className="text-center space-y-8 mb-16">
          <div className="flex justify-center mb-8">
            <OliveLogoWithText size="lg" className="justify-center scale-125" />
          </div>
          
          <div className="space-y-6">
            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 leading-tight">
              Your Smart Life
              <span className="block text-olive">Organizer for Couples</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Transform scattered thoughts into organized action. 
              AI-powered note organization designed for couples managing life together.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto">
            <Button 
              size="lg" 
              onClick={() => navigate("/sign-up")}
              className="w-full sm:w-auto bg-olive hover:bg-olive/90 text-white shadow-lg text-lg px-8 py-6"
            >
              Start Your Journey
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => navigate("/sign-in")}
              className="w-full sm:w-auto border-gray-300 text-gray-700 hover:bg-gray-50 text-lg px-8 py-6"
            >
              Sign In
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm hover:shadow-xl transition-all duration-300">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-olive/10 rounded-full flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-olive" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">AI-Powered Organization</h3>
              <p className="text-gray-600 leading-relaxed">
                Just drop a note and watch Olive automatically categorize, prioritize, and organize your thoughts into actionable items.
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm hover:shadow-xl transition-all duration-300">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-rose-100 rounded-full flex items-center justify-center">
                <Heart className="h-8 w-8 text-rose-500" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Built for Couples</h3>
              <p className="text-gray-600 leading-relaxed">
                Share notes, collaborate on lists, and stay in sync. Perfect for planning dates, managing household tasks, or organizing trips.
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/80 backdrop-blur-sm hover:shadow-xl transition-all duration-300 md:col-span-2 lg:col-span-1">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                <MessageSquare className="h-8 w-8 text-blue-500" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Smart Assistant</h3>
              <p className="text-gray-600 leading-relaxed">
                Ask Olive for help with any note. Get suggestions, find resources, or break down complex tasks into manageable steps.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Value Proposition */}
        <div className="bg-gradient-to-r from-olive/5 to-emerald-50 rounded-2xl p-8 md:p-12 text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-olive/10 rounded-full flex items-center justify-center mb-6">
            <Users className="h-10 w-10 text-olive" />
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            Stop Losing Track of Life's Details
          </h2>
          
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            From "pick up groceries" to "plan anniversary dinner" – Olive turns your scattered thoughts 
            into an organized, shared system that grows with your relationship.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button 
              size="lg" 
              onClick={() => navigate("/sign-up")}
              className="w-full sm:w-auto bg-olive hover:bg-olive/90 text-white shadow-lg text-lg px-8 py-4"
            >
              Get Started Free
            </Button>
            
            <p className="text-sm text-gray-500">
              No credit card required • Start organizing in seconds
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-12 pb-8">
          <p className="text-gray-500">
            Made with ❤️ for couples who want to stay organized together
          </p>
        </div>
      </div>
    </main>
  );
};

export default Landing;