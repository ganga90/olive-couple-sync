import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Check, CheckCheck } from "lucide-react";

interface ChatMessage {
  id: number;
  type: 'voice' | 'text';
  sender: 'user' | 'olive';
  content: string;
  duration?: string;
  timestamp: string;
}

const messages: ChatMessage[] = [
  {
    id: 1,
    type: 'voice',
    sender: 'user',
    content: 'Remind us to pay the vendor $500 next Tuesday and check the budget.',
    duration: '0:08',
    timestamp: '9:41 AM'
  },
  {
    id: 2,
    type: 'text',
    sender: 'olive',
    content: '✅ Added to Shared Calendar for Tuesday.\n\n⚠️ Warning: You are $100 over the \'Vendor\' budget this month.\n\nShould I proceed?',
    timestamp: '9:41 AM'
  }
];

export const WhatsAppChatAnimation = () => {
  const [visibleMessages, setVisibleMessages] = useState<number[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    const runAnimation = () => {
      setVisibleMessages([]);
      setIsTyping(false);

      // Show voice note after 500ms
      const timer1 = setTimeout(() => {
        setVisibleMessages([1]);
      }, 500);

      // Show typing indicator after 1.5s
      const timer2 = setTimeout(() => {
        setIsTyping(true);
      }, 1500);

      // Show Olive's response after 2.5s
      const timer3 = setTimeout(() => {
        setIsTyping(false);
        setVisibleMessages([1, 2]);
      }, 2500);

      // Reset and restart after 8s
      const timer4 = setTimeout(() => {
        setCycleKey(k => k + 1);
      }, 8000);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
        clearTimeout(timer4);
      };
    };

    return runAnimation();
  }, [cycleKey]);

  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      {/* Phone Frame */}
      <div className="relative bg-stone-900 rounded-[3rem] p-3 shadow-2xl shadow-stone-900/30">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-stone-900 rounded-b-2xl z-10" />
        
        {/* Screen */}
        <div className="bg-[#ECE5DD] rounded-[2.5rem] overflow-hidden">
          {/* WhatsApp Header */}
          <div className="bg-[#075E54] px-4 py-3 pt-8 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-olive to-olive/80 flex items-center justify-center text-white font-bold text-sm">
              O
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Olive</p>
              <p className="text-white/70 text-xs">online</p>
            </div>
          </div>

          {/* Chat Area */}
          <div className="h-[400px] px-3 py-4 space-y-3 overflow-hidden">
            <AnimatePresence mode="wait">
              {visibleMessages.includes(1) && (
                <motion.div
                  key={`voice-${cycleKey}`}
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                  className="flex justify-end"
                >
                  <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none px-3 py-2 max-w-[85%] shadow-sm">
                    {/* Voice Note UI */}
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#075E54] flex items-center justify-center">
                        <Mic className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1">
                          {[...Array(20)].map((_, i) => (
                            <div 
                              key={i} 
                              className="w-0.5 bg-[#075E54]/60 rounded-full"
                              style={{ height: `${Math.random() * 12 + 4}px` }}
                            />
                          ))}
                        </div>
                      </div>
                      <span className="text-xs text-stone-500">{messages[0].duration}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-stone-500">{messages[0].timestamp}</span>
                      <CheckCheck className="w-3 h-3 text-[#53BDEB]" />
                    </div>
                  </div>
                </motion.div>
              )}

              {isTyping && (
                <motion.div
                  key={`typing-${cycleKey}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-start"
                >
                  <div className="bg-white rounded-lg rounded-tl-none px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <motion.div 
                        className="w-2 h-2 bg-stone-400 rounded-full"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                      />
                      <motion.div 
                        className="w-2 h-2 bg-stone-400 rounded-full"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
                      />
                      <motion.div 
                        className="w-2 h-2 bg-stone-400 rounded-full"
                        animate={{ y: [0, -5, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {visibleMessages.includes(2) && (
                <motion.div
                  key={`response-${cycleKey}`}
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                  className="flex justify-start"
                >
                  <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 max-w-[85%] shadow-sm">
                    <p className="text-sm text-stone-800 whitespace-pre-line leading-relaxed">
                      {messages[1].content}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[10px] text-stone-500">{messages[1].timestamp}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* "Instant" Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: visibleMessages.includes(2) ? 1 : 0, scale: visibleMessages.includes(2) ? 1 : 0 }}
        className="absolute -right-4 top-1/2 bg-gradient-to-r from-olive to-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg"
      >
        ⚡ Instant
      </motion.div>
    </div>
  );
};
