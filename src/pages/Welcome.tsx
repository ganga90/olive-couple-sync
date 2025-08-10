import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, Bot, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Welcome = () => {
  useSEO({
    title: "Welcome — Olive",
    description: "Welcome to Olive: your shared second brain for couples. Start onboarding to set up shared notes and AI features.",
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-accent/20">
      <section className="mx-auto max-w-md px-4 py-12">
        <div className="mb-8 flex justify-center">
          <div aria-hidden className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/20 shadow-sm">
            <span className="text-4xl" role="img" aria-label="olive">🫒</span>
          </div>
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight md:text-4xl">Welcome to Olive</h1>
        <p className="text-center text-base text-muted-foreground">Your shared second brain for couples</p>

        <p className="mx-auto mt-4 max-w-prose text-center text-sm text-muted-foreground">
          Capture thoughts, organize life, and grow together with AI-powered notes that understand you both.
        </p>

        <ul className="mx-auto mt-6 max-w-sm space-y-3">
          <li className="flex items-center gap-3">
            <Heart className="h-5 w-5 text-primary" aria-hidden />
            <span className="text-sm">Shared notes & lists</span>
          </li>
          <li className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            <span className="text-sm">AI categorization</span>
          </li>
          <li className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary" aria-hidden />
            <span className="text-sm">Personal AI assistant</span>
          </li>
        </ul>

        <div className="mt-8">
          <Link to="/onboarding" aria-label="Continue to onboarding">
            <Button size="lg" className="w-full">
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
