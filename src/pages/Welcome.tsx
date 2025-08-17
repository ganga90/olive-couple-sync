import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heart, Sparkles, Bot, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { OliveLogo } from "@/components/OliveLogo";

const Welcome = () => {
  useSEO({
    title: "Welcome — Olive",
    description: "Welcome to Olive: your shared second brain for couples. Start onboarding to set up shared notes and AI features.",
  });

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-12">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={48} />
          </div>
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-olive-dark md:text-4xl">Welcome to Olive</h1>
        <p className="text-center text-base text-sage">Your shared second brain for couples</p>

        <p className="mx-auto mt-4 max-w-prose text-center text-sm text-muted-foreground">
          Capture thoughts, organize life, and grow together with AI-powered notes that understand you both.
        </p>

        <Card className="mx-auto mt-6 max-w-sm p-4 bg-white/50 border-olive/20 shadow-soft">
          <ul className="space-y-3">
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Heart className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">Shared notes & lists</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Sparkles className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">AI categorization</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Bot className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">Personal AI assistant</span>
            </li>
          </ul>
        </Card>

        <div className="mt-8">
          <Link to="/onboarding" aria-label="Continue to onboarding">
            <Button size="lg" className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft">
              Continue
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
};

export default Welcome;
