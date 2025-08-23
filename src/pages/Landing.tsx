import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";
import { Heart, Brain, Users, Sparkles, ArrowRight, CheckCircle } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";

const Landing = () => {
  const { isAuthenticated, loading } = useAuth();
  const { isOnboarded } = useSupabaseCouple();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);

  useSEO({
    title: "Olive — Your Couple's Shared Brain",
    description: "Transform scattered thoughts into organized memories. Olive is the AI-powered companion that helps couples capture, organize, and remember everything together.",
  });

  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Redirect authenticated users
  useEffect(() => {
    if (!loading && isAuthenticated) {
      if (isOnboarded) {
        navigate("/home");
      } else {
        navigate("/onboarding");
      }
    }
  }, [isAuthenticated, isOnboarded, loading, navigate]);

  const features = [
    {
      icon: Brain,
      title: "AI-Powered Organization",
      description: "Simply speak or type your thoughts. Olive automatically categorizes and organizes everything intelligently."
    },
    {
      icon: Heart,
      title: "Built for Couples",
      description: "Share memories, plans, and ideas seamlessly. Both partners stay in sync across all devices."
    },
    {
      icon: Users,
      title: "Real-time Sync",
      description: "When one partner adds something, the other sees it instantly. Always stay connected."
    },
    {
      icon: Sparkles,
      title: "Smart Lists & Categories",
      description: "From groceries to gift ideas, travel plans to home projects - Olive keeps it all organized."
    }
  ];

  const benefits = [
    "Never forget date ideas or restaurant recommendations",
    "Share grocery lists that update in real-time", 
    "Keep track of home improvement projects together",
    "Remember gift ideas throughout the year",
    "Organize travel plans and bucket list items"
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <div className="animate-pulse">
          <OliveLogo size={48} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-soft">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 pt-16 pb-20">
        <div className="absolute inset-0 bg-gradient-to-br from-olive-primary/5 via-transparent to-sage/10" />
        
        <div className={`relative mx-auto max-w-6xl text-center transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Logo */}
          <div className="mb-8 flex justify-center items-center gap-4">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-olive shadow-olive border border-olive-primary/20">
              <OliveLogo size={40} className="text-white" />
            </div>
            <span className="text-2xl font-semibold text-olive-dark">Meet Olive</span>
          </div>

          {/* Main Headline */}
          <h1 className="mb-6 text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-olive-dark leading-tight">
            <span className="block sm:inline">Your Couple's</span>
            <br className="hidden sm:block" />
            <span className="block sm:inline"> </span>
            <span className="relative">
              Shared Brain
              <div className="absolute -bottom-1 sm:-bottom-2 left-1/2 transform -translate-x-1/2 w-20 sm:w-32 h-0.5 sm:h-1 bg-gradient-olive rounded-full opacity-60" />
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mb-8 mx-auto max-w-2xl text-xl text-muted-foreground leading-relaxed">
            Transform scattered thoughts into organized memories. Olive helps couples capture, organize, and remember everything together with the power of AI.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button 
              size="lg" 
              className="bg-gradient-olive hover:shadow-olive text-white px-8 py-6 text-lg font-semibold rounded-2xl transition-all duration-300 hover:scale-105 group"
              asChild
            >
              <Link to="/sign-up">
                Enter Olive
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
            
            <Button 
              variant="outline" 
              size="lg" 
              className="border-2 border-olive-primary/30 text-olive-dark hover:bg-olive-primary/5 px-8 py-6 text-lg rounded-2xl transition-all duration-300"
              asChild
            >
              <Link to="/sign-in">
                Sign In
              </Link>
            </Button>
          </div>

          {/* Social Proof */}
          <p className="text-sm text-muted-foreground">
            Join couples who never miss a moment together
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-20 bg-white/50">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-olive-dark mb-4">
              Everything you need to stay connected
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Olive combines intelligent organization with seamless sharing, designed specifically for couples.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <Card 
                key={index} 
                className={`p-8 border-olive-primary/20 hover:shadow-olive/50 transition-all duration-500 hover:-translate-y-1 bg-white/80 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}
                style={{ animationDelay: `${index * 200}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 p-3 bg-gradient-olive rounded-xl">
                    <feature.icon className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-olive-dark mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-olive-dark mb-4">
              Perfect for couples who want to
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {benefits.map((benefit, index) => (
              <div 
                key={index}
                className={`flex items-center gap-3 p-4 rounded-xl hover:bg-white/50 transition-all duration-300 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`}
                style={{ animationDelay: `${(index + 4) * 150}ms` }}
              >
                <CheckCircle className="h-5 w-5 text-olive-primary flex-shrink-0" />
                <span className="text-foreground font-medium">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="px-4 py-20 bg-gradient-olive text-white">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to build your shared memory?
          </h2>
          <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
            Join Olive today and never let another moment, idea, or memory slip away.
          </p>
          
          <Button 
            size="lg" 
            className="bg-white text-olive-primary hover:bg-cream px-8 py-6 text-lg font-semibold rounded-2xl transition-all duration-300 hover:scale-105 shadow-lg"
            asChild
          >
            <Link to="/sign-up">
              Start Your Journey Together
              <Heart className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 bg-white/30 border-t border-olive-primary/20">
        <div className="mx-auto max-w-6xl text-center">
          <div className="flex justify-center items-center gap-2 mb-4">
            <OliveLogo size={24} />
            <span className="font-semibold text-olive-dark">Olive</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2024 Olive. Built with love for couples everywhere.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;