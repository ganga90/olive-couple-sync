import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, ListTodo, Calendar, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useMemo } from "react";
import { addHours, isBefore } from "date-fns";

const MobileTabBar = () => {
  const location = useLocation();
  const { t } = useTranslation('common');
  const getLocalizedPath = useLocalizedHref();
  const { notes } = useSupabaseNotesContext();
  
  // Calculate upcoming reminders count (within next 24 hours)
  const upcomingRemindersCount = useMemo(() => {
    const now = new Date();
    const tomorrow = addHours(now, 24);
    
    return notes.filter(note => {
      if (note.completed) return false;
      if (note.reminder_time) {
        const reminderTime = new Date(note.reminder_time);
        return isBefore(now, reminderTime) && isBefore(reminderTime, tomorrow);
      }
      return false;
    }).length;
  }, [notes]);

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
      to: "/lists", 
      icon: ListTodo, 
      label: t('nav.lists'),
      badge: urgentTasksCount > 0 ? urgentTasksCount : 0
    },
    { 
      to: "/calendar", 
      icon: Calendar, 
      label: t('nav.calendar'),
      badge: 0,
      featured: true
    },
    { 
      to: "/reminders", 
      icon: Bell, 
      label: t('nav.reminders'),
      badge: upcomingRemindersCount
    },
  ];

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-5 left-4 right-4 z-50 md:hidden"
    >
      {/* Glassmorphic Floating Dock */}
      <div className="mx-auto max-w-sm rounded-full nav-glass">
        <div className="flex items-center justify-around px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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
                  "relative flex flex-col items-center justify-center gap-1.5 py-2 px-6 rounded-full transition-all duration-300 ease-out",
                  isActive 
                    ? "text-[hsl(130_25%_18%)]" 
                    : "text-stone-400 hover:text-stone-600",
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
                
                {/* Label - hidden for cleaner look */}
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
