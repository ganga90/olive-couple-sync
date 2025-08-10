import { NavLink } from "react-router-dom";
import { Home, ListTodo, User } from "lucide-react";

const MobileTabBar = () => {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden"
    >
      <div className="mx-auto flex max-w-5xl items-stretch px-4 pb-[env(safe-area-inset-bottom)]">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors ${
              isActive ? "text-foreground" : "text-muted-foreground"
            }`
          }
          aria-label="Home"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/lists"
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors ${
              isActive ? "text-foreground" : "text-muted-foreground"
            }`
          }
          aria-label="Lists"
        >
          <ListTodo className="h-5 w-5" aria-hidden="true" />
          <span>Lists</span>
        </NavLink>
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors ${
              isActive ? "text-foreground" : "text-muted-foreground"
            }`
          }
          aria-label="Profile"
        >
          <User className="h-5 w-5" aria-hidden="true" />
          <span>Profile</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default MobileTabBar;
