import { SignedIn, SignedOut, SignInButton, UserProfile } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";

const Profile = () => {
  useSEO({ title: "Profile — Olive", description: "Manage your Olive account profile and settings." });

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-bold">Profile</h1>
        <p className="mb-6 text-muted-foreground">Manage your account information, security, and preferences.</p>

        <SignedOut>
          <div className="rounded-md border p-6">
            <p className="mb-4 text-sm text-muted-foreground">You need to be signed in to manage your profile.</p>
            <SignInButton mode="modal">
              <button className="inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                Sign in
              </button>
            </SignInButton>
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
