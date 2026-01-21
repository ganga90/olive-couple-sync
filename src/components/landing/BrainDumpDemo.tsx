import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Calendar, List, User, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DEMO_INPUT = "dinner with Luca next Wed 7pm, ask Almu to book a table, buy wine for tonight";

const DEMO_RESULTS = {
  tasks: [
    { text: "Book table for dinner", owner: "Almu", due: "Today" },
    { text: "Buy wine", owner: "You", due: "Tonight" }
  ],
  calendar: [
    { text: "Dinner with Luca", date: "Wed 7pm" }
  ],
  lists: [
    { name: "Shopping", items: ["wine"] }
  ]
};

export const BrainDumpDemo = () => {
  const [phase, setPhase] = useState<"typing" | "processing" | "results" | "reset">("typing");
  const [displayedText, setDisplayedText] = useState("");
  const [charIndex, setCharIndex] = useState(0);

  // Reset animation loop
  useEffect(() => {
    const resetTimer = setInterval(() => {
      setPhase("typing");
      setDisplayedText("");
      setCharIndex(0);
    }, 12000); // Full cycle: 12 seconds

    return () => clearInterval(resetTimer);
  }, []);

  // Typing effect
  useEffect(() => {
    if (phase === "typing" && charIndex < DEMO_INPUT.length) {
      const timer = setTimeout(() => {
        setDisplayedText(DEMO_INPUT.slice(0, charIndex + 1));
        setCharIndex(charIndex + 1);
      }, 50); // Typing speed
      return () => clearTimeout(timer);
    } else if (phase === "typing" && charIndex >= DEMO_INPUT.length) {
      // Done typing, start processing
      setTimeout(() => setPhase("processing"), 500);
    }
  }, [phase, charIndex]);

  // Processing to results transition
  useEffect(() => {
    if (phase === "processing") {
      const timer = setTimeout(() => setPhase("results"), 1500);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Demo Container */}
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden">
        {/* Header Bar */}
        <div className="bg-stone-50 px-4 py-3 border-b border-stone-100 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <span className="text-xs text-stone-400 ml-2 font-medium">Olive Brain Dump</span>
          <div className="ml-auto flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-xs text-primary font-medium">AI-Powered</span>
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6">
          <div className="bg-stone-50 rounded-xl p-4 min-h-[80px] font-mono text-sm text-stone-700 relative">
            {displayedText}
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
              className="inline-block w-0.5 h-5 bg-primary ml-0.5 align-middle"
            />
          </div>
        </div>

        {/* Processing State */}
        <AnimatePresence mode="wait">
          {phase === "processing" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-6 pb-6"
            >
              <div className="flex items-center justify-center gap-3 py-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full"
                />
                <span className="text-stone-600 font-medium">Olive is organizing...</span>
              </div>
            </motion.div>
          )}

          {/* Results */}
          {phase === "results" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="px-6 pb-6 space-y-3"
            >
              {/* Calendar Event */}
              {DEMO_RESULTS.calendar.map((event, i) => (
                <motion.div
                  key={`cal-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="flex items-center gap-3 bg-purple-50 rounded-lg p-3 border border-purple-100"
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-stone-800">{event.text}</p>
                    <p className="text-xs text-stone-500">{event.date}</p>
                  </div>
                  <Check className="h-5 w-5 text-green-500" />
                </motion.div>
              ))}

              {/* Tasks */}
              {DEMO_RESULTS.tasks.map((task, i) => (
                <motion.div
                  key={`task-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="flex items-center gap-3 bg-blue-50 rounded-lg p-3 border border-blue-100"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-stone-800">{task.text}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">{task.owner}</Badge>
                      <Badge variant="outline" className="text-xs">{task.due}</Badge>
                    </div>
                  </div>
                  <Check className="h-5 w-5 text-green-500" />
                </motion.div>
              ))}

              {/* Lists */}
              {DEMO_RESULTS.lists.map((list, i) => (
                <motion.div
                  key={`list-${i}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className="flex items-center gap-3 bg-green-50 rounded-lg p-3 border border-green-100"
                >
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <List className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-stone-800">{list.name}</p>
                    <p className="text-xs text-stone-500">+{list.items.join(", ")}</p>
                  </div>
                  <Check className="h-5 w-5 text-green-500" />
                </motion.div>
              ))}

              {/* Success Message */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="text-center pt-2"
              >
                <p className="text-sm text-stone-500">
                  ✨ Organized in <span className="font-semibold text-primary">1.2 seconds</span>
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Caption */}
      <p className="text-center text-sm text-stone-500 mt-4">
        Watch Olive parse your thoughts in real-time
      </p>
    </div>
  );
};
