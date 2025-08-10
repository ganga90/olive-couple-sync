import { SignedIn, SignedOut, SignIn, UserProfile } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";
import { Link } from "react-router-dom";

const Profile = () => {
  useSEO({ title: "Profile — Olive", description: "Manage your Olive account profile and settings." });

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-bold">Profile</h1>
        <p className="mb-6 text-muted-foreground">Manage your account information, security, and preferences.</p>

        <SignedOut>
          <div className="rounded-md border p-4 space-y-2">
            <SignIn fallbackRedirectUrl="/onboarding" />
            <p className="text-center text-xs text-muted-foreground">
              Can’t see the form? <Link to="/sign-in" className="underline underline-offset-4">Open sign-in page</Link>
            </p>
          </div>
        </SignedOut>

        <SignedIn>
          <div className="rounded-md border p-2">
            <UserProfile routing="hash" />
          </div>
        </SignedIn>
      </section>
    </main>
  );
};

export default Profile;
