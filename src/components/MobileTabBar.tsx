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
      {/* Floating Dock */}
      <div className="mx-auto max-w-sm rounded-full bg-white/90 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-border/30">
        <div className="flex items-center justify-around px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
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
                  "relative flex flex-col items-center justify-center gap-1 py-2 px-5 rounded-full transition-all duration-300 ease-out",
                  isActive 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground",
                  tab.featured && !isActive && "text-primary/70"
                )}
                aria-label={tab.label}
              >
                {/* Icon container */}
                <div className={cn(
                  "relative flex items-center justify-center w-7 h-7 transition-transform duration-300 ease-out",
                  isActive && "scale-110",
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
                      "absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center",
                      "rounded-full text-[10px] font-bold",
                      "bg-destructive text-destructive-foreground",
                      "animate-scale-in"
                    )}>
                      {tab.badge > 9 ? "9+" : tab.badge}
                    </span>
                  )}
                </div>
                
                {/* Label */}
                <span className={cn(
                  "text-[10px] font-medium transition-all duration-300",
                  isActive && "font-semibold"
                )}>
                  {tab.label}
                </span>
                
                {/* Active indicator - small green dot */}
                {isActive && (
                  <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
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
