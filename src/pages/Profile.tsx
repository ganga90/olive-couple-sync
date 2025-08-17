import { SignedIn, SignedOut, SignIn, UserProfile } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { OliveLogo } from "@/components/OliveLogo";

const Profile = () => {
  useSEO({ title: "Profile — Olive", description: "Manage your Olive account profile and settings." });

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
        </div>
        
        <h1 className="mb-2 text-center text-3xl font-bold text-olive-dark">Profile</h1>
        <p className="mb-6 text-center text-muted-foreground">Manage your account information, security, and preferences.</p>

        <SignedOut>
          <Card className="p-4 bg-white/50 border-olive/20 shadow-soft space-y-2">
            <SignIn fallbackRedirectUrl="/welcome" />
            <p className="text-center text-xs text-muted-foreground">
              Can't see the form? <Link to="/sign-in" className="text-olive hover:text-olive/80 underline underline-offset-4">Open sign-in page</Link>
            </p>
          </Card>
        </SignedOut>

        <SignedIn>
          <Card className="p-2 bg-white/50 border-olive/20 shadow-soft">
            <UserProfile routing="hash" />
          </Card>
        </SignedIn>
      </section>
    </main>
  );
};

export default Profile;