import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCheck } from "lucide-react";

interface VoidMessage {
  id: number;
  content: string;
  timestamp: string;
  readAgo: string;
}

interface OliveResponse {
  forMessageId: number;
  content: string;
  timestamp: string;
}

const voidMessages: VoidMessage[] = [
  {
    id: 1,
    content: "Gate code: 4821#",
    timestamp: "Mon 9:12 AM",
    readAgo: "Read 3 weeks ago",
  },
  {
    id: 2,
    content: "Check out this restaurant → bit.ly/ristor",
    timestamp: "Thu 2:34 PM",
    readAgo: "Read 2 weeks ago",
  },
  {
    id: 3,
    content: "Milk, eggs, bread, avocados",
    timestamp: "Sat 11:07 AM",
    readAgo: "Read 5 days ago",
  },
  {
    id: 4,
    content: "Business idea: subscription pet food delivery for small breeds",
    timestamp: "Tue 8:45 PM",
    readAgo: "Read 1 day ago",
  },
];

const oliveResponses: OliveResponse[] = [
  {
    forMessageId: 1,
    content: "🔑 Saved to Home > Access Codes. I'll remind you when you're nearby.",
    timestamp: "9:12 AM",
  },
  {
    forMessageId: 2,
    content: "🍕 Bookmarked under Restaurants. Added to your \"Try Next\" list.",
    timestamp: "2:34 PM",
  },
  {
    forMessageId: 3,
    content: "🛒 Added to your Grocery List. Shared with your partner.",
    timestamp: "11:07 AM",
  },
  {
    forMessageId: 4,
    content: "💡 Saved to Ideas. I found 3 competitors — want a summary?",
    timestamp: "8:45 PM",
  },
];

type Phase = "void" | "transition" | "olive";

export const WhatsAppChatAnimation = () => {
  const [phase, setPhase] = useState<Phase>("void");
  const [visibleVoidMessages, setVisibleVoidMessages] = useState<number[]>([]);
  const [visibleOliveResponses, setVisibleOliveResponses] = useState<number[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);

  const runAnimation = useCallback(() => {
    // Reset state
    setPhase("void");
    setVisibleVoidMessages([]);
    setVisibleOliveResponses([]);
    setIsTyping(false);

    const timers: NodeJS.Timeout[] = [];

    // Phase 1: "The Void" — stagger user messages
    timers.push(setTimeout(() => setVisibleVoidMessages([1]), 400));
    timers.push(setTimeout(() => setVisibleVoidMessages([1, 2]), 1000));
    timers.push(setTimeout(() => setVisibleVoidMessages([1, 2, 3]), 1600));
    timers.push(setTimeout(() => setVisibleVoidMessages([1, 2, 3, 4]), 2200));

    // Phase 2: Transition at 5s
    timers.push(
      setTimeout(() => {
        setPhase("transition");
      }, 4800)
    );

    timers.push(
      setTimeout(() => {
        setPhase("olive");
      }, 5200)
    );

    // Phase 2: "Olive" — show responses one by one with typing indicators
    const oliveStart = 5600;
    const responseDelay = 1400;

    oliveResponses.forEach((_, index) => {
      const baseTime = oliveStart + index * responseDelay;

      // Show typing
      timers.push(
        setTimeout(() => {
          setIsTyping(true);
        }, baseTime)
      );

      // Show response, hide typing
      timers.push(
        setTimeout(() => {
          setIsTyping(false);
          setVisibleOliveResponses((prev) => [...prev, oliveResponses[index].forMessageId]);
        }, baseTime + 800)
      );
    });

    // Cycle restart at 13s
    timers.push(
      setTimeout(() => {
        setCycleKey((k) => k + 1);
      }, 13000)
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    return runAnimation();
  }, [cycleKey, runAnimation]);

  const isOlivePhase = phase === "olive";
  const isTransition = phase === "transition";

  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      {/* Phone Frame */}
      <div className="relative bg-stone-900 rounded-[3rem] p-3 shadow-2xl shadow-stone-900/30">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-stone-900 rounded-b-2xl z-10" />

        {/* Screen */}
        <div className="bg-[#ECE5DD] rounded-[2.5rem] overflow-hidden">
          {/* Header — animates between Void and Olive */}
          <motion.div
            animate={{
              backgroundColor: isOlivePhase || isTransition ? "#075E54" : "#6B7280",
            }}
            transition={{ duration: 0.4 }}
            className="px-4 py-3 pt-8 flex items-center gap-3"
          >
            <motion.div
              animate={{
                backgroundColor: isOlivePhase || isTransition ? "#3A5A40" : "#9CA3AF",
              }}
              transition={{ duration: 0.4 }}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
            >
              <AnimatePresence mode="wait">
                {isOlivePhase ? (
                  <motion.span
                    key="olive-icon"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                  >
                    O
                  </motion.span>
                ) : (
                  <motion.span
                    key="void-icon"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="text-xs"
                  >
                    👤
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
            <div>
              <AnimatePresence mode="wait">
                {isOlivePhase ? (
                  <motion.div
                    key="olive-header"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p className="text-white font-semibold text-sm">Olive</p>
                    <p className="text-white/70 text-xs">online</p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="void-header"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p className="text-white font-semibold text-sm">Me (You)</p>
                    <p className="text-white/60 text-xs">message yourself</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Chat Area */}
          <div className="h-[400px] px-3 py-3 space-y-2 overflow-hidden">
            <AnimatePresence>
              {voidMessages.map((msg) => {
                if (!visibleVoidMessages.includes(msg.id)) return null;

                const hasOliveResponse = visibleOliveResponses.includes(msg.id);

                return (
                  <div key={`group-${msg.id}-${cycleKey}`}>
                    {/* User message */}
                    <motion.div
                      initial={{ opacity: 0, y: 15, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex justify-end mb-1"
                    >
                      <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none px-3 py-1.5 max-w-[80%] shadow-sm">
                        <p className="text-xs text-stone-800 leading-relaxed">
                          {msg.content}
                        </p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[9px] text-stone-400">{msg.timestamp}</span>
                          <CheckCheck className="w-3 h-3 text-[#53BDEB]" />
                        </div>
                      </div>
                    </motion.div>

                    {/* "Read X ago" label — only in void phase */}
                    {!isOlivePhase && !hasOliveResponse && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.6 }}
                        className="flex justify-end mb-2"
                      >
                        <span className="text-[9px] text-stone-400 italic pr-1">
                          {msg.readAgo}
                        </span>
                      </motion.div>
                    )}

                    {/* Olive response */}
                    {hasOliveResponse && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.25 }}
                        className="flex justify-start mb-2"
                      >
                        <div className="bg-white rounded-lg rounded-tl-none px-3 py-1.5 max-w-[85%] shadow-sm">
                          <p className="text-xs text-stone-800 leading-relaxed">
                            {oliveResponses.find((r) => r.forMessageId === msg.id)?.content}
                          </p>
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-[9px] text-stone-400">
                              {oliveResponses.find((r) => r.forMessageId === msg.id)?.timestamp}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isTyping && (
                <motion.div
                  key={`typing-${cycleKey}`}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-white rounded-lg rounded-tl-none px-4 py-2.5 shadow-sm">
                    <div className="flex gap-1">
                      <motion.div
                        className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: 0 }}
                      />
                      <motion.div
                        className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: 0.12 }}
                      />
                      <motion.div
                        className="w-1.5 h-1.5 bg-stone-400 rounded-full"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: 0.24 }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Phase label badge */}
      <AnimatePresence mode="wait">
        {!isOlivePhase && visibleVoidMessages.length > 0 && (
          <motion.div
            key="void-badge"
            initial={{ opacity: 0, scale: 0, x: 10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -right-3 top-24 bg-stone-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg"
          >
            📭 The Void
          </motion.div>
        )}
        {isOlivePhase && (
          <motion.div
            key="olive-badge"
            initial={{ opacity: 0, scale: 0, x: 10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -right-3 top-24 bg-gradient-to-r from-olive to-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg"
          >
            ⚡ Olive
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
