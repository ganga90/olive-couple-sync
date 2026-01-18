import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Home, ListTodo, Calendar, Bell, User, Settings } from "lucide-react";
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
    { to: "/lists", icon: ListTodo, label: t('nav.lists'), badge: urgentTasksCount },
    { to: "/calendar", icon: Calendar, label: t('nav.calendar'), badge: 0 },
    { to: "/reminders", icon: Bell, label: t('nav.reminders'), badge: upcomingRemindersCount },
    { to: "/profile", icon: User, label: t('nav.profile'), badge: 0 },
  ];

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 flex-col bg-sidebar-background border-r border-sidebar-border z-40">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <Link to={getLocalizedPath("/")} className="hover:opacity-80 transition-opacity">
          <OliveLogoWithText size="md" />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
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
                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group select-none",
                isActive 
                  ? "bg-primary/10 text-primary font-medium" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className={cn(
                "h-5 w-5 transition-transform group-hover:scale-110",
                isActive && "text-primary"
              )} />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-xs font-medium bg-[hsl(var(--priority-high))] text-white">
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-sidebar-border">
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
