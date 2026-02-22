import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { BetaBadge } from "@/components/BetaBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { getSupabase } from "@/lib/supabaseClient";

let ClerkWaitlist: React.ComponentType<any> | null = null;
try {
  // Dynamic import check — only use if Clerk exposes the Waitlist component
  const clerkReact = require("@clerk/clerk-react");
  if (clerkReact.Waitlist) {
    ClerkWaitlist = clerkReact.Waitlist;
  }
} catch {
  // Clerk Waitlist not available
}

const RequestAccessPage = () => {
  const { t } = useTranslation("auth");
  const navigate = useLocalizedNavigate();
  const rawNavigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [clerkReady, setClerkReady] = useState(false);

  useSEO({
    title: t("requestAccess.title", "Request Beta Access") + " — Olive",
    description: t("requestAccess.seoDescription", "Join the Olive beta and be among the first to experience AI-powered organization."),
  });

  // Check if Clerk Waitlist rendered successfully after a short delay
  useEffect(() => {
    if (!ClerkWaitlist) return;
    const timer = setTimeout(() => {
      const clerkEl = document.querySelector('.clerk-waitlist-wrapper .cl-rootBox');
      setClerkReady(!!clerkEl);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleBack = () => {
    if (window.history.length > 1) rawNavigate(-1);
    else navigate("/");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;

    setIsSubmitting(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.functions.invoke("send-feedback", {
        body: {
          category: "beta_request",
          message: `Beta Access Request\nName: ${name.trim()}\nEmail: ${email.trim()}`,
          contactEmail: email.trim(),
          userName: name.trim(),
          userId: "beta_request",
          page: "/request-access",
          userAgent: navigator.userAgent,
        },
      });

      if (error) throw error;

      setSubmitted(true);
      toast.success(t("requestAccess.success", "Request submitted! 🎉"));
    } catch (err) {
      console.error("[RequestAccess] Error:", err);
      toast.error(t("requestAccess.error", "Failed to submit. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
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

        {/* Try Clerk Waitlist first — hidden until confirmed rendering */}
        {ClerkWaitlist && (
          <div className={`clerk-waitlist-wrapper ${clerkReady ? '' : 'hidden'}`}>
            <ClerkWaitlist
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
                  form: "gap-4",
                },
              }}
            />
          </div>
        )}

        {/* Fallback email form — shows if Clerk Waitlist is unavailable or failed */}
        {(!ClerkWaitlist || !clerkReady) && (
          <AnimatePresence mode="wait">
            {!submitted ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="p-6 bg-white/50 border border-olive/20 shadow-soft rounded-xl">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="ra-name">{t("requestAccess.nameLabel", "Your name")}</Label>
                      <Input
                        id="ra-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t("requestAccess.namePlaceholder", "First name")}
                        required
                        autoFocus
                        autoComplete="given-name"
                        className="bg-background text-base"
                        maxLength={100}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ra-email" className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        {t("requestAccess.emailLabel", "Email address")}
                      </Label>
                      <Input
                        id="ra-email"
                        type="email"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("requestAccess.emailPlaceholder", "you@example.com")}
                        required
                        autoComplete="email"
                        name="email"
                        className="bg-background text-base"
                        maxLength={255}
                      />
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full bg-olive hover:bg-olive/90 text-white font-semibold rounded-full shadow-lg shadow-olive/20"
                      disabled={isSubmitting || !email.trim() || !name.trim()}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t("requestAccess.submitting", "Submitting...")}
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          {t("requestAccess.submit", "Join the Waitlist")}
                        </>
                      )}
                    </Button>
                  </form>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6"
              >
                <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mx-auto">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">
                  {t("requestAccess.successTitle", "You're on the list! 🎉")}
                </h2>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  {t("requestAccess.successMessage", "We'll review your request and send you an invite link to your email soon. Keep an eye on your inbox!")}
                </p>
                <Button variant="outline" onClick={() => navigate("/")} className="mt-4">
                  {t("common.buttons.backToHome", "Back to Home")}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        )}

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
