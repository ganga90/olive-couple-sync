import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heart, Sparkles, Bot, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { OliveLogo } from "@/components/OliveLogo";

const Welcome = () => {
  useSEO({
    title: "Drop a brain-dump. Olive turns it into next steps.",
    description: "Type or speak whatever's on your mind—Olive auto-categorizes into lists, assigns owners & dates, and keeps you both in sync.",
  });

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-12">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={48} />
          </div>
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-olive-dark md:text-4xl">Drop a brain-dump. Olive turns it into next steps.</h1>
        <p className="text-center text-base text-sage">Type or speak whatever's on your mind—we'll organize it</p>

        <p className="mx-auto mt-4 max-w-prose text-center text-sm text-muted-foreground">
          Auto-categorizes into lists, assigns owners & dates, and keeps you both in sync. Ask Olive to help with any task.
        </p>

        <Card className="mx-auto mt-6 max-w-sm p-4 bg-white/50 border-olive/20 shadow-soft">
          <ul className="space-y-3">
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Heart className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">AI brain-dump organizing</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Sparkles className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">Owner & date detection</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-olive/10">
                <Bot className="h-4 w-4 text-olive" aria-hidden />
              </div>
              <span className="text-sm text-olive-dark">Ask Olive anything</span>
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
