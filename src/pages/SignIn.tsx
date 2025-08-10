import { SignIn } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";

const SignInPage = () => {
  useSEO({ title: "Sign in — Olive", description: "Sign in to your Olive account to manage notes and lists." });

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-md px-4 py-10">
        <h1 className="mb-2 text-3xl font-bold">Sign in</h1>
        <p className="mb-6 text-muted-foreground">Access your notes, lists, and preferences.</p>
        <div className="rounded-md border p-4">
          <SignIn fallbackRedirectUrl="/welcome" />
        </div>
      </section>
    </main>
  );
};

export default SignInPage;
