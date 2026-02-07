import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OliveLogo } from "@/components/OliveLogo";
import { useSearchParams } from "react-router-dom";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useAuth } from "@/providers/AuthProvider";
import { useEffect } from "react";
import { UserPlus, LogIn } from "lucide-react";
import { motion } from "framer-motion";

const AuthPage = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/home";
  const navigate = useLocalizedNavigate();
  const { isAuthenticated, loading } = useAuth();
  
  useSEO({ title: `${t('entry.title', 'Get Started')} — Olive`, description: t('entry.description', 'Create an account or sign in to Olive') });

  // Redirect if already signed in
  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate(redirectUrl, { replace: true });
    }
  }, [isAuthenticated, loading, navigate, redirectUrl]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-16">
        {/* Logo */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 flex justify-center"
        >
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <OliveLogo size={40} />
          </div>
        </motion.div>
        
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {t('entry.title', 'Welcome to Olive')}
          </h1>
          <p className="text-muted-foreground">
            {t('entry.description', 'Your AI-powered life organizer for couples')}
          </p>
        </motion.div>
        
        {/* Action Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="space-y-4"
        >
          {/* Create Account Card */}
          <Card 
            className="p-6 bg-white/80 border-olive/20 shadow-soft hover:shadow-lg transition-all cursor-pointer group"
            onClick={() => navigate(`/sign-up?redirect=${encodeURIComponent(redirectUrl)}`)}
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <UserPlus className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {t('entry.createAccount', 'Create New Account')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('entry.createAccountDesc', 'Set up your space in under a minute')}
                </p>
              </div>
            </div>
          </Card>

          {/* Login Card */}
          <Card 
            className="p-6 bg-white/80 border-olive/20 shadow-soft hover:shadow-lg transition-all cursor-pointer group"
            onClick={() => navigate(`/sign-in?redirect=${encodeURIComponent(redirectUrl)}`)}
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 group-hover:bg-accent/20 transition-colors">
                <LogIn className="h-6 w-6 text-accent-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {t('entry.login', 'Log In')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('entry.loginDesc', 'Welcome back to your organized life')}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Trust signal */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center text-sm text-muted-foreground mt-8"
        >
          {t('entry.secureLogin', 'Sign in with a verification code or password')}
        </motion.p>
      </section>
    </main>
  );
};

export default AuthPage;
