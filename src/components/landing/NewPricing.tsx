import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Crown, Users, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "For individuals getting started",
    icon: <Sparkles className="w-5 h-5" />,
    iconBg: "bg-stone-100 text-stone-500",
    features: [
      "1 space",
      "50 notes / month",
      "10 AI requests / day",
      "Basic organization",
    ],
    popular: false,
  },
  {
    id: "personal",
    name: "Personal",
    price: 7.99,
    description: "For couples & power users",
    icon: <Crown className="w-5 h-5" />,
    iconBg: "bg-amber-100 text-amber-600",
    features: [
      "3 spaces",
      "500 notes / month",
      "100 AI requests / day",
      "WhatsApp integration",
      "Calendar sync",
      "Daily briefings",
    ],
    popular: false,
  },
  {
    id: "team",
    name: "Team",
    price: 14.99,
    description: "For small teams up to 10",
    icon: <Users className="w-5 h-5" />,
    iconBg: "bg-primary/10 text-primary",
    features: [
      "10 spaces",
      "2,000 notes / month",
      "500 AI requests / day",
      "Everything in Personal",
      "Delegation & workflows",
      "Polls & decisions",
      "Conflict detection",
    ],
    popular: true,
  },
  {
    id: "business",
    name: "Business",
    price: 29.99,
    description: "For professionals & agencies",
    icon: <Briefcase className="w-5 h-5" />,
    iconBg: "bg-indigo-100 text-indigo-600",
    features: [
      "Unlimited spaces",
      "Unlimited notes",
      "Unlimited AI requests",
      "Everything in Team",
      "Client pipeline",
      "Industry templates",
      "Expense splitting",
      "Priority support",
    ],
    popular: false,
  },
];

export const NewPricing = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  return (
    <section className="py-20 px-4 bg-stone-50" id="pricing">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1.5 rounded-full tracking-wide uppercase">
            {t('pricing.beta.badge', 'Free during Beta')}
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mt-4 mb-3">
            {t('pricing.headline', 'Simple, transparent pricing')}
          </h2>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            {t('pricing.beta.description', "Everything is free while we shape the experience together. Plans activate when beta ends.")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={cn(
                "relative rounded-2xl bg-white border p-6 flex flex-col",
                plan.popular
                  ? "border-primary shadow-lg ring-1 ring-primary/20"
                  : "border-stone-200 shadow-sm"
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </span>
                </div>
              )}

              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", plan.iconBg)}>
                {plan.icon}
              </div>

              <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>

              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold text-foreground">
                  {plan.price === 0 ? "Free" : `$${plan.price}`}
                </span>
                {plan.price > 0 && (
                  <span className="text-sm text-muted-foreground">/mo</span>
                )}
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link to={getLocalizedPath("/request-access")} className="w-full">
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className="w-full rounded-xl"
                >
                  {t('pricing.beta.cta', 'Get Started Free')}
                </Button>
              </Link>
            </motion.div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          {t('pricing.beta.note', 'No credit card required. All features unlocked during beta.')}
        </p>
      </div>
    </section>
  );
};
