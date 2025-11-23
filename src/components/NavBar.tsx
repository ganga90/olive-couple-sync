import { Link, NavLink, useLocation } from "react-router-dom";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useIsMobile } from "@/hooks/use-mobile";

const NavBar = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  
  // Hide NavBar on mobile for main app routes (they use MobileLayout instead)
  const mainAppRoutes = ['/home', '/lists', '/calendar', '/reminders', '/profile'];
  const isMainAppRoute = mainAppRoutes.includes(location.pathname) || 
    location.pathname.startsWith('/lists/') || 
    location.pathname.startsWith('/notes/');
  
  if (isMobile && isMainAppRoute) {
    return null;
  }
  
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="hover:opacity-80 transition-opacity">
          <OliveLogoWithText size="sm" />
        </Link>
        <div className="flex items-center gap-3">
          <NavLink to="/lists" className="text-sm text-muted-foreground hover:text-foreground">
            Lists
          </NavLink>
          <NavLink to="/calendar" className="text-sm text-muted-foreground hover:text-foreground">
            Calendar
          </NavLink>
          <NavLink to="/reminders" className="text-sm text-muted-foreground hover:text-foreground">
            Reminders
          </NavLink>
          <NavLink to="/profile" className="text-sm text-muted-foreground hover:text-foreground">
            Profile
          </NavLink>
          <SignedOut>
            <Link to="/sign-in">
              <Button size="sm">Sign in</Button>
            </Link>
            <Link to="/sign-up">
              <Button variant="outline" size="sm">Sign up</Button>
            </Link>
          </SignedOut>
          <SignedIn>
            <UserButton appearance={{ elements: { userButtonPopoverFooter: "hidden" } }} showName />
          </SignedIn>
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
