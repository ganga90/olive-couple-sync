import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { InviteFlow } from "@/components/InviteFlow";
import { 
  User, 
  Users, 
  ArrowRight, 
  ArrowLeft,
  CheckCircle2,
  Sparkles
} from "lucide-react";

type OnboardingStep = "role" | "names" | "demo" | "invite";

const Onboarding = () => {
  const [step, setStep] = useState<OnboardingStep>("role");
  const [userRole, setUserRole] = useState<"solo" | "couple" | null>(null);
  const [you, setYou] = useState("");
  const [partner, setPartner] = useState("");
  const navigate = useNavigate();
  
  useSEO({ 
    title: "Get Started — Olive", 
    description: "Set up Olive to personalize your task management experience." 
  });

  const handleRoleSelect = (role: "solo" | "couple") => {
    setUserRole(role);
    setStep("names");
  };

  const handleNamesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!you.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (userRole === "couple" && !partner.trim()) {
      toast.error("Please enter your partner's name");
      return;
    }
    
    if (userRole === "couple") {
      setStep("invite");
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    console.log('[Onboarding] handleComplete called, navigating to home');
    toast.success("Welcome to Olive! 🫒", {
      description: "Your personal task organizer is ready."
    });
    navigate("/home");
  };

  const handleBack = () => {
    if (step === "names") setStep("role");
    else if (step === "invite") setStep("names");
  };

  // Progress indicator
  const getProgress = () => {
    switch (step) {
      case "role": return 25;
      case "names": return 50;
      case "invite": return 75;
      default: return 100;
    }
  };

  return (
    <main className="min-h-screen bg-gradient-hero flex flex-col">
      {/* Header with back button and progress */}
      <header className="px-6 py-4 flex items-center justify-between">
        {step !== "role" ? (
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        ) : (
          <div className="w-9" />
        )}
        
        {/* Progress bar */}
        <div className="flex-1 max-w-[200px] mx-4">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${getProgress()}%` }}
            />
          </div>
        </div>
        
        <div className="w-9" />
      </header>

      {/* Content */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        {/* Logo */}
        <div className="mb-6 animate-scale-in">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
            <OliveLogo size={32} />
          </div>
        </div>

        {/* Step: Role Selection */}
        {step === "role" && (
          <div className="w-full max-w-md animate-fade-up">
            <h1 className="text-2xl font-bold text-foreground text-center mb-2">
              How will you use Olive?
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              We'll personalize your experience based on your choice.
            </p>
            
            <div className="space-y-3">
              <Card 
                className={`p-5 cursor-pointer transition-all duration-200 border-2 hover:border-primary/50 hover:shadow-raised ${
                  userRole === "solo" ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => handleRoleSelect("solo")}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">Just me</h3>
                    <p className="text-sm text-muted-foreground">Personal task management</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </Card>

              <Card 
                className={`p-5 cursor-pointer transition-all duration-200 border-2 hover:border-primary/50 hover:shadow-raised ${
                  userRole === "couple" ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => handleRoleSelect("couple")}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Users className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">With my partner</h3>
                    <p className="text-sm text-muted-foreground">Shared lists & coordination</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Step: Names */}
        {step === "names" && (
          <div className="w-full max-w-md animate-fade-up">
            <h1 className="text-2xl font-bold text-foreground text-center mb-2">
              {userRole === "couple" ? "What are your names?" : "What's your name?"}
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              We'll use this to personalize your tasks.
            </p>

            <Card className="p-6 bg-card/80 border-border/50 shadow-card">
              <form onSubmit={handleNamesSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="you" className="text-foreground font-medium">
                    Your name
                  </Label>
                  <Input 
                    id="you" 
                    value={you} 
                    onChange={(e) => setYou(e.target.value)} 
                    placeholder="e.g., Alex"
                    className="h-12 text-base border-border/50 focus:border-primary"
                    autoFocus
                  />
                </div>
                
                {userRole === "couple" && (
                  <div className="space-y-2">
                    <Label htmlFor="partner" className="text-foreground font-medium">
                      Partner's name
                    </Label>
                    <Input 
                      id="partner" 
                      value={partner} 
                      onChange={(e) => setPartner(e.target.value)} 
                      placeholder="e.g., Sam"
                      className="h-12 text-base border-border/50 focus:border-primary"
                    />
                  </div>
                )}
                
                <Button type="submit" size="lg" className="w-full group">
                  Continue
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </form>
            </Card>
          </div>
        )}

        {/* Step: Invite (Couples only) */}
        {step === "invite" && (
          <div className="w-full max-w-md animate-fade-up">
            <h1 className="text-2xl font-bold text-foreground text-center mb-2">
              Connect with {partner}
            </h1>
            <p className="text-muted-foreground text-center mb-6">
              Invite your partner to share your Olive space.
            </p>
            
            <InviteFlow 
              you={you} 
              partner={partner} 
              onComplete={handleComplete}
            />
          </div>
        )}
      </section>

      {/* Footer hint */}
      <footer className="px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          Your data is encrypted and secure
        </p>
      </footer>
    </main>
  );
};

export default Onboarding;
