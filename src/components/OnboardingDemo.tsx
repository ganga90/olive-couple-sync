import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Sparkles, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DemoBubble {
  id: number;
  sender: "user" | "olive";
  content: string;
  delay: number; // ms from start
}

const demoConversation: DemoBubble[] = [
  {
    id: 1,
    sender: "user",
    content: "Milk, eggs, bread, avocados",
    delay: 600,
  },
  {
    id: 2,
    sender: "olive",
    content: "🛒 Added 4 items to your Grocery List.",
    delay: 2000,
  },
  {
    id: 3,
    sender: "user",
    content: "Dinner with Sarah Friday 7pm",
    delay: 3800,
  },
  {
    id: 4,
    sender: "olive",
    content: "📅 Created event: Dinner with Sarah — Friday at 7 PM. Reminder set for 2 hours before.",
    delay: 5400,
  },
  {
    id: 5,
    sender: "user",
    content: "Gate code 4821#",
    delay: 7000,
  },
  {
    id: 6,
    sender: "olive",
    content: "🔑 Saved to Home > Access Codes.",
    delay: 8400,
  },
];

interface OnboardingDemoProps {
  onContinue: () => void;
}

export const OnboardingDemo = ({ onContinue }: OnboardingDemoProps) => {
  const { t } = useTranslation("onboarding");
  const [visibleBubbles, setVisibleBubbles] = useState<number[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [animationComplete, setAnimationComplete] = useState(false);

  const runDemo = useCallback(() => {
    setVisibleBubbles([]);
    setIsTyping(false);
    setAnimationComplete(false);

    const timers: NodeJS.Timeout[] = [];

    demoConversation.forEach((bubble) => {
      // Show typing indicator before Olive messages
      if (bubble.sender === "olive") {
        timers.push(
          setTimeout(() => {
            setIsTyping(true);
          }, bubble.delay - 800)
        );
      }

      timers.push(
        setTimeout(() => {
          setIsTyping(false);
          setVisibleBubbles((prev) => [...prev, bubble.id]);
        }, bubble.delay)
      );
    });

    // Mark animation complete
    timers.push(
      setTimeout(() => {
        setAnimationComplete(true);
      }, 9200)
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    return runDemo();
  }, [runDemo]);

  return (
    <div className="w-full max-w-md animate-fade-up space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground font-serif">
          {t("demoPreview.header", {
            defaultValue: "This is how Olive works.",
          })}
        </h1>
        <p className="text-muted-foreground">
          {t("demoPreview.subtext", {
            defaultValue:
              "Just text naturally. Olive understands and organizes everything.",
          })}
        </p>
      </div>

      {/* Simulated Chat */}
      <div className="bg-[#ECE5DD] rounded-2xl overflow-hidden shadow-lg border border-stone-200">
        {/* Mini WhatsApp header */}
        <div className="bg-[#075E54] px-4 py-2.5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#3A5A40] flex items-center justify-center text-white font-bold text-xs">
            O
          </div>
          <div>
            <p className="text-white font-semibold text-xs">Olive</p>
            <p className="text-white/70 text-[10px]">online</p>
          </div>
        </div>

        {/* Chat bubbles */}
        <div className="px-3 py-3 space-y-2 min-h-[280px] max-h-[320px] overflow-hidden">
          <AnimatePresence>
            {demoConversation.map((bubble) => {
              if (!visibleBubbles.includes(bubble.id)) return null;

              const isUser = bubble.sender === "user";

              return (
                <motion.div
                  key={bubble.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-lg px-3 py-1.5 max-w-[80%] shadow-sm ${
                      isUser
                        ? "bg-[#DCF8C6] rounded-tr-none"
                        : "bg-white rounded-tl-none"
                    }`}
                  >
                    <p className="text-xs text-stone-800 leading-relaxed">
                      {bubble.content}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[9px] text-stone-400">
                        {isUser ? "now" : "now"}
                      </span>
                      {isUser && (
                        <CheckCheck className="w-3 h-3 text-[#53BDEB]" />
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* Typing indicator */}
            {isTyping && (
              <motion.div
                key="typing"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex justify-start"
              >
                <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 shadow-sm">
                  <div className="flex gap-1">
                    <motion.div
                      className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                      animate={{ y: [0, -3, 0] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: 0,
                      }}
                    />
                    <motion.div
                      className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                      animate={{ y: [0, -3, 0] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: 0.12,
                      }}
                    />
                    <motion.div
                      className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                      animate={{ y: [0, -3, 0] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: 0.24,
                      }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Insight callout */}
      <AnimatePresence>
        {animationComplete && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3"
          >
            <Sparkles className="w-5 h-5 text-primary flex-shrink-0" />
            <p className="text-sm text-foreground">
              {t("demoPreview.insight", {
                defaultValue:
                  "3 messages. Groceries sorted, dinner scheduled, code saved. Zero apps opened.",
              })}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Continue button */}
      <AnimatePresence>
        {animationComplete && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Button
              onClick={onContinue}
              className="w-full h-12 text-base group"
            >
              {t("demoPreview.continue", { defaultValue: "Got it — let's set up" })}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Skip */}
      <button
        onClick={onContinue}
        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("skip", { defaultValue: "Skip" })}
      </button>
    </div>
  );
};
