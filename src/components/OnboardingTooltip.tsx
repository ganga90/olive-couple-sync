import { useEffect, useRef } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OnboardingTooltipProps {
  isVisible: boolean;
  onDismiss: () => void;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function OnboardingTooltip({
  isVisible,
  onDismiss,
  title,
  description,
  position = 'bottom',
  className,
}: OnboardingTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };

    // Delay adding listeners to prevent immediate dismissal
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isVisible, onDismiss]);

  if (!isVisible) return null;

  const positionClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-primary border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-primary border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-primary border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-primary border-t-transparent border-b-transparent border-l-transparent',
  };

  return (
    <div
      ref={tooltipRef}
      className={cn(
        "absolute z-50 w-72 p-4 rounded-xl bg-primary text-primary-foreground shadow-lg animate-fade-up",
        positionClasses[position],
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Arrow */}
      <div
        className={cn(
          "absolute w-0 h-0 border-[8px]",
          arrowClasses[position]
        )}
      />

      {/* Close button */}
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-primary-foreground/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Content */}
      <div className="flex gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 pr-4">
          <h4 className="font-semibold text-sm mb-1">{title}</h4>
          <p className="text-xs opacity-90 leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Got it button */}
      <Button
        size="sm"
        variant="secondary"
        className="w-full mt-3 bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0"
        onClick={onDismiss}
      >
        Got it!
      </Button>
    </div>
  );
}
