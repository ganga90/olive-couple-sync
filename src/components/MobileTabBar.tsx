import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, ListTodo, Calendar, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useMemo } from "react";

const MobileTabBar = () => {
  const location = useLocation();
  const { t } = useTranslation('common');
  const getLocalizedPath = useLocalizedHref();
  const { notes } = useSupabaseNotesContext();
  
  

  // Calculate overdue/high priority tasks count
  const urgentTasksCount = useMemo(() => {
    const now = new Date();
    return notes.filter(note => {
      if (note.completed) return false;
      if (note.dueDate && new Date(note.dueDate) < now) return true;
      if (note.priority === 'high') return true;
      return false;
    }).length;
  }, [notes]);

  const tabs = [
    { 
      to: "/home", 
      icon: Home, 
      label: t('nav.home'),
      badge: 0
    },
    { 
      to: "/myday", 
      icon: Sun, 
      label: t('nav.myday', 'My Day'),
      badge: 0,
      featured: true
    },
    { 
      to: "/lists", 
      icon: ListTodo, 
      label: t('nav.lists'),
      badge: urgentTasksCount > 0 ? urgentTasksCount : 0
    },
    { 
      to: "/calendar", 
      icon: Calendar, 
      label: t('nav.calendar'),
      badge: 0
    },
  ];

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{
        // Respect iOS safe area for home indicator
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
      }}
    >
      {/* Premium Glassmorphic Floating Dock - enhanced blur and shadow */}
      <div className={cn(
        "mx-4 mb-2 rounded-full",
        // Glassmorphism: translucent white + strong backdrop blur
        "bg-white/80 backdrop-blur-xl",
        // Subtle border for depth
        "border border-white/50",
        // Premium shadow for elevation
        "shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
      )}>
        <div className="flex items-center justify-around px-3 py-3">
          {tabs.map((tab) => {
            const localizedPath = getLocalizedPath(tab.to);
            const isActive = location.pathname === localizedPath || 
              location.pathname.endsWith(tab.to) ||
              (tab.to === "/lists" && location.pathname.includes("/lists/")) ||
              (tab.to === "/home" && location.pathname.includes("/notes/"));
            
            return (
              <NavLink
                key={tab.to}
                to={localizedPath}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1.5 py-2 px-6 rounded-full transition-all duration-300 ease-out select-ui touch-target-48",
                  isActive 
                    ? "text-[hsl(130_25%_18%)]" 
                    : "text-stone-400 active:text-stone-600",
                  tab.featured && !isActive && "text-primary/70"
                )}
                aria-label={tab.label}
              >
                {/* Icon container */}
                <div className={cn(
                  "relative flex items-center justify-center transition-all duration-300 ease-out",
                  isActive ? "w-8 h-8 scale-110" : "w-7 h-7",
                  tab.featured && "w-8 h-8"
                )}>
                  <tab.icon 
                    className={cn(
                      "transition-all duration-300",
                      tab.featured ? "h-6 w-6" : "h-5 w-5",
                      isActive && "stroke-[2.5]"
                    )} 
                    aria-hidden="true" 
                  />
                  
                  {/* Badge */}
                  {tab.badge > 0 && (
                    <span className={cn(
                      "absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 flex items-center justify-center",
                      "rounded-full text-[10px] font-bold shadow-sm",
                      "bg-[hsl(var(--priority-high))] text-white",
                      "animate-scale-in"
                    )}>
                      {tab.badge > 9 ? "9+" : tab.badge}
                    </span>
                  )}
                </div>
                
                {/* Label */}
                <span className={cn(
                  "text-[10px] font-medium transition-all duration-300",
                  isActive ? "font-semibold opacity-100" : "opacity-70"
                )}>
                  {tab.label}
                </span>
                
                {/* Active indicator - glowing green dot */}
                {isActive && (
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(130_22%_29%/0.5)]" />
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default MobileTabBar;
