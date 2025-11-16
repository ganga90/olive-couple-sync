import { NavLink } from "react-router-dom";
import { Home, ListTodo, Calendar, Bell } from "lucide-react";

const MobileTabBar = () => {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background shadow-[var(--shadow-bottom-bar)] md:hidden"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-4 px-8 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <NavLink
          to="/home"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 py-1 px-6 rounded-[var(--radius-md)] transition-all ${
              isActive 
                ? "text-primary" 
                : "text-muted-foreground"
            }`
          }
          aria-label="Home"
        >
          <Home className="h-6 w-6" aria-hidden="true" strokeWidth={2.5} />
          <span className="text-xs font-medium">Home</span>
        </NavLink>
        
        <NavLink
          to="/lists"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 py-1 px-6 rounded-[var(--radius-md)] transition-all ${
              isActive 
                ? "text-primary" 
                : "text-muted-foreground"
            }`
          }
          aria-label="Lists"
        >
          <ListTodo className="h-6 w-6" aria-hidden="true" strokeWidth={2.5} />
          <span className="text-xs font-medium">Lists</span>
        </NavLink>
        
        <NavLink
          to="/calendar"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 py-1 px-6 rounded-[var(--radius-md)] transition-all ${
              isActive 
                ? "text-primary" 
                : "text-muted-foreground"
            }`
          }
          aria-label="Calendar"
        >
          <Calendar className="h-6 w-6" aria-hidden="true" strokeWidth={2.5} />
          <span className="text-xs font-medium">Calendar</span>
        </NavLink>
        
        <NavLink
          to="/reminders"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 py-1 px-6 rounded-[var(--radius-md)] transition-all ${
              isActive 
                ? "text-primary" 
                : "text-muted-foreground"
            }`
          }
          aria-label="Reminders"
        >
          <Bell className="h-6 w-6" aria-hidden="true" strokeWidth={2.5} />
          <span className="text-xs font-medium">Reminders</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default MobileTabBar;
