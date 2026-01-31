import React, { useState } from "react";
import { Plus, X, MessageCircle, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { NoteInput } from "@/components/NoteInput";
import { useAuth } from "@/providers/AuthProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Lazy load the Ask Olive chat component
const AskOliveChat = React.lazy(() => import("@/components/AskOliveChatGlobal"));

export const FloatingSpeedDial: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeModal, setActiveModal] = useState<"ask-olive" | "brain-dump" | null>(null);
  const { isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const { t } = useTranslation("common");

  // Only show for authenticated users
  if (!isAuthenticated) return null;

  const handleOptionClick = (option: "ask-olive" | "brain-dump") => {
    setActiveModal(option);
    setIsExpanded(false);
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  const speedDialOptions = [
    {
      id: "ask-olive" as const,
      icon: MessageCircle,
      label: t("speedDial.askOlive", "Ask Olive"),
      className: "bg-primary text-primary-foreground hover:bg-primary/90",
    },
    {
      id: "brain-dump" as const,
      icon: Brain,
      label: t("speedDial.brainDump", "Brain-dump"),
      className: "bg-accent text-accent-foreground hover:bg-accent/90",
    },
  ];

  // Responsive dialog wrapper
  const ModalWrapper = isMobile ? Drawer : Dialog;
  const ModalContent = isMobile ? DrawerContent : DialogContent;
  const ModalHeader = isMobile ? DrawerHeader : DialogHeader;
  const ModalTitle = isMobile ? DrawerTitle : DialogTitle;

  return (
    <>
      {/* Speed Dial Container */}
      <div className="fixed bottom-28 right-6 z-40 flex flex-col-reverse items-center gap-3 md:bottom-8">
        {/* Expanded Options */}
        <AnimatePresence>
          {isExpanded && (
            <>
              {speedDialOptions.map((option, index) => (
                <motion.div
                  key={option.id}
                  initial={{ opacity: 0, scale: 0.3, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.3, y: 20 }}
                  transition={{ 
                    duration: 0.2, 
                    delay: index * 0.05,
                    type: "spring",
                    stiffness: 300,
                    damping: 20
                  }}
                  className="flex items-center gap-3"
                >
                  {/* Label Tooltip */}
                  <motion.span
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: index * 0.05 + 0.1 }}
                    className="px-3 py-1.5 rounded-full bg-background/95 backdrop-blur-sm shadow-md text-sm font-medium text-foreground whitespace-nowrap"
                  >
                    {option.label}
                  </motion.span>
                  
                  {/* Option Button */}
                  <Button
                    onClick={() => handleOptionClick(option.id)}
                    className={cn(
                      "h-12 w-12 rounded-full shadow-lg transition-all duration-200 hover:scale-110",
                      option.className
                    )}
                    size="icon"
                  >
                    <option.icon className="h-5 w-5" />
                  </Button>
                </motion.div>
              ))}
            </>
          )}
        </AnimatePresence>

        {/* Main FAB Button */}
        <Button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "h-14 w-14 rounded-full shadow-lg transition-all duration-300",
            isExpanded 
              ? "bg-muted text-muted-foreground hover:bg-muted/80 rotate-45" 
              : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-110"
          )}
          size="icon"
        >
          {isExpanded ? (
            <X className="h-6 w-6 transition-transform" />
          ) : (
            <Plus className="h-6 w-6" />
          )}
        </Button>
      </div>

      {/* Backdrop when expanded */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-30"
            onClick={() => setIsExpanded(false)}
          />
        )}
      </AnimatePresence>

      {/* Ask Olive Modal */}
      <ModalWrapper open={activeModal === "ask-olive"} onOpenChange={(open) => !open && closeModal()}>
        <ModalContent className={cn(
          "bg-background",
          !isMobile && "max-w-2xl max-h-[80vh]"
        )}>
          <ModalHeader>
            <ModalTitle className="flex items-center gap-2 text-foreground">
              <MessageCircle className="h-5 w-5 text-primary" />
              {t("speedDial.askOlive", "Ask Olive")}
            </ModalTitle>
          </ModalHeader>
          <React.Suspense fallback={
            <div className="flex items-center justify-center p-8">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          }>
            <AskOliveChat onClose={closeModal} />
          </React.Suspense>
        </ModalContent>
      </ModalWrapper>

      {/* Brain-dump Modal */}
      <ModalWrapper open={activeModal === "brain-dump"} onOpenChange={(open) => !open && closeModal()}>
        <ModalContent className={cn(
          "bg-background",
          !isMobile && "max-w-2xl"
        )}>
          <ModalHeader>
            <ModalTitle className="flex items-center gap-2 text-foreground">
              <Brain className="h-5 w-5 text-accent" />
              {t("speedDial.brainDump", "Brain-dump")}
            </ModalTitle>
          </ModalHeader>
          <div className="px-4 pb-4 md:px-0">
            <NoteInput onNoteAdded={closeModal} />
          </div>
        </ModalContent>
      </ModalWrapper>
    </>
  );
};

export default FloatingSpeedDial;
