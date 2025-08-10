import { SignUp } from "@clerk/clerk-react";
import { useSEO } from "@/hooks/useSEO";

const SignUpPage = () => {
  useSEO({ title: "Sign up — Olive", description: "Create your Olive account to start organizing together." });

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-md px-4 py-10">
        <h1 className="mb-2 text-3xl font-bold">Create account</h1>
        <p className="mb-6 text-muted-foreground">Join Olive and set up your space in minutes.</p>
        <div className="rounded-md border p-4">
          <SignUp fallbackRedirectUrl="/onboarding" />
        </div>
      </section>
    </main>
  );
};

export default SignUpPage;
