import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

const NavBar = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { t } = useTranslation('common');
  const getLocalizedPath = useLocalizedHref();
  
  // Hide NavBar on mobile for main app routes (they use MobileLayout instead)
  const mainAppRoutes = ['/home', '/lists', '/calendar', '/reminders', '/profile'];
  const isMainAppRoute = mainAppRoutes.some(route => 
    location.pathname.endsWith(route) || 
    location.pathname.includes('/lists/') || 
    location.pathname.includes('/notes/')
  );
  
  if (isMobile && isMainAppRoute) {
    return null;
  }
  
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to={getLocalizedPath("/")} className="hover:opacity-80 transition-opacity">
          <OliveLogoWithText size="sm" />
        </Link>
        <div className="flex items-center gap-3">
          <NavLink to={getLocalizedPath("/lists")} className="text-sm text-muted-foreground hover:text-foreground">
            {t('nav.lists')}
          </NavLink>
          <NavLink to={getLocalizedPath("/calendar")} className="text-sm text-muted-foreground hover:text-foreground">
            {t('nav.calendar')}
          </NavLink>
          <NavLink to={getLocalizedPath("/reminders")} className="text-sm text-muted-foreground hover:text-foreground">
            {t('nav.reminders')}
          </NavLink>
          <NavLink to={getLocalizedPath("/profile")} className="text-sm text-muted-foreground hover:text-foreground">
            {t('nav.profile')}
          </NavLink>
          <SignedOut>
            <Link to={getLocalizedPath("/sign-in")}>
              <Button size="sm">{t('buttons.signIn')}</Button>
            </Link>
            <Link to={getLocalizedPath("/sign-up")}>
              <Button variant="outline" size="sm">{t('buttons.signUp')}</Button>
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
