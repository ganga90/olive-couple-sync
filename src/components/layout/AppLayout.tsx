import React from 'react';
import { useLocation } from 'react-router-dom';
import { MobileHeader } from '../MobileHeader';
import MobileTabBar from '../MobileTabBar';
import DesktopSidebar from './DesktopSidebar';
import ContextRail from './ContextRail';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLanguage } from '@/providers/LanguageProvider';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { stripLocalePath } = useLanguage();
  
  // Get the path without locale prefix for route matching
  const cleanPath = stripLocalePath(location.pathname);
  
  // Routes that should hide the app layout entirely (landing, auth, onboarding)
  const hideLayoutRoutes = [
    '/landing',
    '/sign-in',
    '/sign-up',
    '/onboarding',
    '/welcome',
    '/'
  ];
  
  const shouldHideLayout = hideLayoutRoutes.includes(cleanPath);
  
  // Main app routes that get the full navigation treatment
  const mainAppRoutes = ['/home', '/lists', '/calendar', '/reminders', '/profile'];
  const isMainAppRoute = mainAppRoutes.includes(cleanPath) || 
    cleanPath.startsWith('/lists/') || 
    cleanPath.startsWith('/notes/');

  // If we should hide the layout, just render children
  if (shouldHideLayout) {
    return <>{children}</>;
  }

  // If not a main app route, just render children without nav
  if (!isMainAppRoute) {
    return <>{children}</>;
  }

  // Handle undefined state during initial render
  if (isMobile === undefined) {
    return (
      <div className="flex flex-col h-screen">
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    );
  }

  // Mobile layout: Header + Content + Bottom Tab Bar
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen">
        {/* Fixed Header with safe area padding */}
        <MobileHeader />
        
        {/* Main Content Area - with padding for header and bottom bar */}
        <main className="flex-1 overflow-hidden pt-[calc(57px+env(safe-area-inset-top))] pb-[calc(90px+env(safe-area-inset-bottom))]">
          {children}
        </main>
        
        {/* Fixed Bottom Tab Bar with safe area padding */}
        <MobileTabBar />
      </div>
    );
  }

  // Desktop layout: 3-Column Grid - Sidebar | Floating Sheet | Context Rail
  return (
    <div className="min-h-screen bg-[hsl(40_20%_88%)]">
      {/* CSS Grid: Precise 3-column layout for xl screens */}
      <div className="grid grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] min-h-screen">
        {/* Left Column: Navigation Sidebar - blends with stone */}
        <DesktopSidebar />
        
        {/* Center Column: "FLOATING SHEET OF PAPER" */}
        <main className="py-6 px-6 xl:px-8">
          {/* Paper Surface - Floating sheet with heavy shadow */}
          <div className="bg-[hsl(48_60%_99%)] rounded-3xl shadow-2xl min-h-[calc(100vh-3rem)] overflow-hidden">
            {/* Central Focus Container - max-w-3xl (768px) centered with generous top padding */}
            <div className="max-w-3xl mx-auto px-8 lg:px-12 pt-12 lg:pt-16 pb-12">
              {children}
            </div>
          </div>
        </main>
        
        {/* Right Column: Context Rail - Sticky, transparent on stone */}
        <aside className="hidden xl:block py-8 pr-8">
          <ContextRail />
        </aside>
      </div>
    </div>
  );
};

export default AppLayout;
