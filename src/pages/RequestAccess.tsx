import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { BetaBadge } from "@/components/BetaBadge";
import { ArrowLeft } from "lucide-react";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useNavigate } from "react-router-dom";
import { Waitlist } from "@clerk/clerk-react";

const RequestAccessPage = () => {
  const { t } = useTranslation("auth");
  const navigate = useLocalizedNavigate();
  const rawNavigate = useNavigate();

  useSEO({
    title: t("requestAccess.title", "Request Beta Access") + " — Olive",
    description: t("requestAccess.seoDescription", "Join the Olive beta and be among the first to experience AI-powered organization."),
  });

  const handleBack = () => {
    if (window.history.length > 1) rawNavigate(-1);
    else navigate("/");
  };

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        {/* Back */}
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 mb-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("signUp.back", "Back")}
        </button>

        {/* Logo */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={32} />
          </div>
          <BetaBadge size="md" />
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold text-foreground">
          {t("requestAccess.headline", "Join the Olive Beta")}
        </h1>
        <p className="mb-6 text-center text-muted-foreground">
          {t("requestAccess.subheadline", "We're letting in a small group of early users. Join the waitlist and we'll send you an invite.")}
        </p>

        {/* Clerk Waitlist Component */}
        <div className="clerk-waitlist-wrapper">
          <Waitlist 
            afterJoinWaitlistUrl="/request-access"
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-soft border border-olive/20 bg-white/50 backdrop-blur-sm rounded-xl",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                formButtonPrimary: "bg-olive hover:bg-olive/90 text-white font-semibold rounded-full shadow-lg shadow-olive/20",
                formFieldInput: "bg-background border-olive/20 text-base rounded-lg",
                formFieldLabel: "text-foreground font-medium",
                footer: "hidden",
                identityPreview: "bg-muted/50 rounded-lg",
                form: "gap-4",
              },
              layout: {
                socialButtonsPlacement: "bottom",
                showOptionalFields: false,
              },
            }}
          />
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          {t("signUp.hasAccount", "Already have an account?")}{" "}
          <button
            type="button"
            onClick={() => navigate("/sign-in")}
            className="text-primary hover:underline font-medium"
          >
            {t("signUp.signInLink", "Sign in")}
          </button>
        </p>
      </section>
    </main>
  );
};

export default RequestAccessPage;
