import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { 
  Heart, 
  Brain, 
  Users, 
  CheckCircle, 
  ArrowRight,
  Sparkles,
  MessageCircle,
  ListTodo,
  Calendar
} from "lucide-react";

const Landing = () => {
  useSEO({ 
    title: "Olive - Your Shared Digital Brain for Couples", 
    description: "Never forget another moment, idea, or task. Olive uses AI to organize your shared life seamlessly, keeping you and your partner perfectly in sync." 
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-olive/5 via-white to-sage/10">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 flex justify-center">
            <div className="flex items-center gap-3">
              <OliveLogo size={48} className="drop-shadow-lg" />
              <h1 className="text-4xl font-bold text-olive-dark">Olive</h1>
            </div>
          </div>
          
          <h2 className="mb-6 text-5xl sm:text-6xl font-bold leading-tight text-olive-dark">
            Your Shared
            <span className="block text-olive bg-gradient-to-r from-olive to-sage bg-clip-text text-transparent">
              Digital Brain
            </span>
          </h2>
          
          <p className="mb-8 text-xl text-olive-dark/80 max-w-2xl mx-auto">
            Never let another moment, idea, or memory slip away. Olive uses AI to organize your shared life seamlessly, 
            keeping you and your partner perfectly in sync.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Link to="/sign-up">
              <Button 
                size="lg" 
                className="bg-olive hover:bg-olive/90 text-white shadow-lg hover:shadow-xl transition-all duration-300 text-lg px-8 py-3"
              >
                Start Your Journey Together
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link to="/sign-in">
              <Button 
                variant="outline" 
                size="lg"
                className="border-olive/30 text-olive-dark hover:bg-olive/5 text-lg px-8 py-3"
              >
                Sign In
              </Button>
            </Link>
          </div>

          {/* Trust Indicators */}
          <div className="flex justify-center items-center gap-6 text-sm text-olive-dark/60">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-olive" />
              <span>AI-Powered</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-olive" />
              <span>Secure & Private</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-olive" />
              <span>Always in Sync</span>
            </div>
          </div>
        </div>

        {/* Floating Elements */}
        <div className="absolute top-20 left-10 opacity-20">
          <Heart className="h-8 w-8 text-olive animate-pulse" />
        </div>
        <div className="absolute bottom-32 right-12 opacity-20">
          <Brain className="h-10 w-10 text-sage animate-bounce" style={{ animationDelay: '1s' }} />
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 bg-white/50">
        <div className="mx-auto max-w-6xl">
          <h3 className="text-3xl font-bold text-center mb-12 text-olive-dark">
            Everything You Need, Nothing You Don't
          </h3>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="p-6 bg-white/80 border-olive/20 shadow-soft hover:shadow-lg transition-all duration-300">
              <div className="mb-4">
                <div className="h-12 w-12 rounded-xl bg-olive/10 flex items-center justify-center mb-3">
                  <Sparkles className="h-6 w-6 text-olive" />
                </div>
                <h4 className="text-xl font-semibold text-olive-dark mb-2">AI Organization</h4>
                <p className="text-olive-dark/70">
                  Drop unorganized thoughts and watch Olive intelligently categorize, prioritize, and structure them automatically.
                </p>
              </div>
            </Card>

            <Card className="p-6 bg-white/80 border-olive/20 shadow-soft hover:shadow-lg transition-all duration-300">
              <div className="mb-4">
                <div className="h-12 w-12 rounded-xl bg-olive/10 flex items-center justify-center mb-3">
                  <Users className="h-6 w-6 text-olive" />
                </div>
                <h4 className="text-xl font-semibold text-olive-dark mb-2">Seamless Sharing</h4>
                <p className="text-olive-dark/70">
                  Perfect synchronization between partners. Add a note, and your partner sees it instantly, beautifully organized.
                </p>
              </div>
            </Card>

            <Card className="p-6 bg-white/80 border-olive/20 shadow-soft hover:shadow-lg transition-all duration-300">
              <div className="mb-4">
                <div className="h-12 w-12 rounded-xl bg-olive/10 flex items-center justify-center mb-3">
                  <MessageCircle className="h-6 w-6 text-olive" />
                </div>
                <h4 className="text-xl font-semibold text-olive-dark mb-2">Smart Assistant</h4>
                <p className="text-olive-dark/70">
                  Ask Olive for help with any note or task. Get suggestions, reminders, and intelligent assistance when you need it.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4">
        <div className="mx-auto max-w-4xl">
          <h3 className="text-3xl font-bold text-center mb-12 text-olive-dark">
            Simple. Smart. Together.
          </h3>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-olive/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-olive">1</span>
              </div>
              <h4 className="text-lg font-semibold text-olive-dark mb-2">Drop Your Thoughts</h4>
              <p className="text-olive-dark/70">
                Just write naturally - "groceries for dinner, book dentist appointment, plan anniversary"
              </p>
            </div>

            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-olive/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-olive">2</span>
              </div>
              <h4 className="text-lg font-semibold text-olive-dark mb-2">AI Organizes</h4>
              <p className="text-olive-dark/70">
                Olive automatically sorts into lists, sets priorities, and makes everything actionable
              </p>
            </div>

            <div className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-olive/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-olive">3</span>
              </div>
              <h4 className="text-lg font-semibold text-olive-dark mb-2">Stay Synced</h4>
              <p className="text-olive-dark/70">
                Both partners see updates instantly, perfectly organized and ready to act on
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 px-4 bg-gradient-to-r from-olive/5 to-sage/5">
        <div className="mx-auto max-w-3xl text-center">
          <h3 className="text-3xl font-bold text-olive-dark mb-4">
            Ready to Never Forget Again?
          </h3>
          <p className="text-lg text-olive-dark/80 mb-8">
            Join Olive today and never let another moment, idea, or memory slip away.
          </p>
          <Link to="/sign-up">
            <Button 
              size="lg" 
              className="bg-olive hover:bg-olive/90 text-white shadow-lg hover:shadow-xl transition-all duration-300 text-lg px-8 py-3"
            >
              Start Your Journey Together
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 bg-olive-dark/5 border-t border-olive/10">
        <div className="mx-auto max-w-4xl text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <OliveLogo size={24} />
            <span className="font-semibold text-olive-dark">Olive</span>
          </div>
          <p className="text-sm text-olive-dark/60">
            © 2025 Olive. Your shared digital brain for life.
          </p>
        </div>
      </footer>
    </main>
  );
};

export default Landing;