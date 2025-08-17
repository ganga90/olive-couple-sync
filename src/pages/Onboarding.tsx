import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useCouple } from "@/providers/CoupleProvider";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";

const Onboarding = () => {
  const [you, setYou] = useState("");
  const [partner, setPartner] = useState("");
  const navigate = useNavigate();
  const { setNames } = useCouple();
  useSEO({ title: "Onboarding — Olive", description: "Set up your couple names to personalize Olive." });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!you || !partner) {
      toast.error("Please enter both names");
      return;
    }
    setNames(you, partner);
    toast.success("Welcome to Olive! You're all set.");
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>
        
        <h1 className="mb-2 text-center text-2xl font-semibold text-olive-dark">Welcome! Let's set up Olive</h1>
        <p className="mb-6 text-center text-muted-foreground">We'll personalize your space. You can change these anytime.</p>
        
        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="you" className="text-olive-dark font-medium">Your name</Label>
              <Input 
                id="you" 
                value={you} 
                onChange={(e) => setYou(e.target.value)} 
                placeholder="e.g., Alex"
                className="border-olive/30 focus:border-olive focus:ring-olive/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner" className="text-olive-dark font-medium">Partner's name</Label>
              <Input 
                id="partner" 
                value={partner} 
                onChange={(e) => setPartner(e.target.value)} 
                placeholder="e.g., Sam"
                className="border-olive/30 focus:border-olive focus:ring-olive/20"
              />
            </div>
            <Button type="submit" className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft">
              Continue
            </Button>
          </form>
        </Card>
      </section>
    </main>
  );
};

export default Onboarding;