import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Home, ListTodo, Calendar, Bell, User, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { cn } from "@/lib/utils";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useMemo } from "react";
import { addHours, isBefore } from "date-fns";

const DesktopSidebar = () => {
  const location = useLocation();
  const { t } = useTranslation('common');
  const getLocalizedPath = useLocalizedHref();
  const { notes } = useSupabaseNotesContext();

  // Calculate badge counts
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

  const urgentTasksCount = useMemo(() => {
    const now = new Date();
    return notes.filter(note => {
      if (note.completed) return false;
      if (note.dueDate && new Date(note.dueDate) < now) return true;
      if (note.priority === 'high') return true;
      return false;
    }).length;
  }, [notes]);

  const navItems = [
    { to: "/home", icon: Home, label: t('nav.home'), badge: 0 },
    { to: "/myday", icon: Sun, label: t('nav.myday', 'My Day'), badge: 0 },
    { to: "/lists", icon: ListTodo, label: t('nav.lists'), badge: urgentTasksCount },
    { to: "/calendar", icon: Calendar, label: t('nav.calendar'), badge: 0 },
    { to: "/reminders", icon: Bell, label: t('nav.reminders'), badge: upcomingRemindersCount },
    { to: "/profile", icon: User, label: t('nav.profile'), badge: 0 },
  ];

  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-full flex-col bg-transparent z-40">
      {/* Logo - Larger padding, blends with stone desk */}
      <div className="p-8">
        <Link to={getLocalizedPath("/")} className="hover:opacity-80 transition-opacity">
          <OliveLogoWithText size="md" />
        </Link>
      </div>

      {/* Navigation - RADICAL TYPOGRAPHY: text-lg, py-5, icons 28px */}
      <nav className="flex-1 p-6 space-y-3">
        {navItems.map((item) => {
          const localizedPath = getLocalizedPath(item.to);
          const isActive = location.pathname === localizedPath || 
            location.pathname.endsWith(item.to) ||
            (item.to === "/lists" && location.pathname.includes("/lists/")) ||
            (item.to === "/home" && location.pathname.includes("/notes/"));

          return (
            <NavLink
              key={item.to}
              to={localizedPath}
              className={cn(
                "flex items-center gap-4 px-5 py-5 rounded-2xl transition-all duration-200 group select-none",
                "text-lg font-semibold",
                isActive 
                  ? "bg-primary/20 text-primary shadow-lg border-l-4 border-primary" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className={cn(
                "h-7 w-7 transition-transform group-hover:scale-110",
                isActive && "text-primary"
              )} />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && (
                <span className="min-w-[28px] h-8 px-2.5 flex items-center justify-center rounded-full text-sm font-bold bg-[hsl(var(--priority-high))] text-white">
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User Section - transparent background */}
      <div className="p-6">
        <SignedOut>
          <div className="space-y-2">
            <Link to={getLocalizedPath("/sign-in")} className="block">
              <Button variant="default" size="sm" className="w-full">
                {t('buttons.signIn')}
              </Button>
            </Link>
            <Link to={getLocalizedPath("/sign-up")} className="block">
              <Button variant="outline" size="sm" className="w-full">
                {t('buttons.signUp')}
              </Button>
            </Link>
          </div>
        </SignedOut>
        <SignedIn>
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-sidebar-accent/50">
            <UserButton 
              appearance={{ 
                elements: { 
                  userButtonPopoverFooter: "hidden",
                  userButtonAvatarBox: "w-10 h-10"
                } 
              }} 
              showName 
            />
          </div>
        </SignedIn>
      </div>
    </aside>
  );
};

export default DesktopSidebar;
