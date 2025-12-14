import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Brain, Calendar, Users, Bell, ArrowRight, Sparkles, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { OliveLogo } from "@/components/OliveLogo";

const Welcome = () => {
  useSEO({
    title: "Olive — Drop a brain-dump, get organized",
    description: "Type or speak whatever's on your mind—Olive auto-categorizes into lists, assigns owners & dates, and keeps you both in sync.",
  });

  const benefits = [
    {
      icon: Brain,
      title: "Brain-dump anything",
      description: "Tasks, notes, ideas—just speak or type"
    },
    {
      icon: Calendar,
      title: "Auto calendar sync",
      description: "Google Calendar integration built-in"
    },
    {
      icon: Users,
      title: "Share with partner",
      description: "Coordinate tasks together seamlessly"
    },
    {
      icon: Bell,
      title: "Smart reminders",
      description: "Never forget what matters most"
    }
  ];

  return (
    <main className="min-h-screen bg-gradient-hero overflow-hidden">
      {/* Hero Section */}
      <section className="relative mx-auto max-w-lg px-6 pt-16 pb-8">
        {/* Decorative elements */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl -z-10" />
        
        {/* Logo */}
        <div className="mb-8 flex justify-center animate-fade-up">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse-soft" />
            <div className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-card shadow-raised border border-border/50">
              <OliveLogo size={40} />
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center space-y-3 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight">
            Drop a brain-dump.
            <br />
            <span className="text-primary">Olive turns it into next steps.</span>
          </h1>
          <p className="text-base text-muted-foreground max-w-sm mx-auto">
            Type or speak whatever's on your mind—we'll organize it into actionable tasks.
          </p>
        </div>

        {/* Benefits Grid */}
        <div className="mt-10 grid grid-cols-2 gap-3 animate-fade-up" style={{ animationDelay: '200ms' }}>
          {benefits.map((benefit, index) => (
            <Card 
              key={benefit.title}
              className="p-4 bg-card/80 backdrop-blur-sm border-border/50 shadow-card hover:shadow-raised transition-all duration-200 hover:-translate-y-0.5"
              style={{ animationDelay: `${300 + index * 50}ms` }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <benefit.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground leading-tight">
                    {benefit.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {benefit.description}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="mt-10 space-y-3 animate-fade-up" style={{ animationDelay: '400ms' }}>
          <Link to="/onboarding" className="block">
            <Button variant="accent" size="xl" className="w-full group">
              Get Started
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
          
          <Link to="/landing" className="block">
            <Button variant="ghost" size="lg" className="w-full text-muted-foreground hover:text-foreground">
              <Play className="mr-2 h-4 w-4" />
              See How It Works
            </Button>
          </Link>
        </div>

        {/* Demo Preview Card */}
        <Card className="mt-8 p-4 bg-card/60 backdrop-blur-sm border-border/50 shadow-soft animate-fade-up" style={{ animationDelay: '500ms' }}>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-muted-foreground">Try it</span>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 border border-border/30">
            <p className="text-sm text-foreground/80 italic">
              "dinner with Maria next Friday, call doctor Monday, buy groceries"
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-muted-foreground">→ 3 tasks auto-created</span>
          </div>
        </Card>

        {/* Social Proof */}
        <div className="mt-8 text-center animate-fade-up" style={{ animationDelay: '600ms' }}>
          <p className="text-xs text-muted-foreground">
            Trusted by couples who want to stay organized together
          </p>
        </div>
      </section>
    </main>
  );
};

export default Welcome;
