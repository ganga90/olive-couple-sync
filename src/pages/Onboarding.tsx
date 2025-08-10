import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const Onboarding = () => {
  const [you, setYou] = useState("");
  const [partner, setPartner] = useState("");
  const navigate = useNavigate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!you || !partner) {
      toast.error("Please enter both names");
      return;
    }
    toast.success("Welcome to Olive! You're all set.");
    navigate("/lists");
  };

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Welcome! Let’s set up Olive</h1>
      <p className="mb-6 text-muted-foreground">We’ll personalize your space. You can change these anytime.</p>
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="you">Your name</Label>
          <Input id="you" value={you} onChange={(e) => setYou(e.target.value)} placeholder="e.g., Alex" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="partner">Partner’s name</Label>
          <Input id="partner" value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="e.g., Sam" />
        </div>
        <Button type="submit" className="w-full">Continue</Button>
      </form>
    </main>
  );
};

export default Onboarding;
