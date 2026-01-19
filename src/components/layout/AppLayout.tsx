import React from 'react';
import { useLocation } from 'react-router-dom';
import { MobileHeader } from '../MobileHeader';
import MobileTabBar from '../MobileTabBar';
import DesktopSidebar from './DesktopSidebar';
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

  // Desktop layout: Sidebar + Content
  return (
    <div className="flex min-h-screen">
      {/* Fixed Left Sidebar - 288px (w-72) */}
      <DesktopSidebar />
      
      {/* Main Content Area - with left padding to clear sidebar */}
      <main className="flex-1 ml-72">
        {/* Central Focus Container - AGGRESSIVE max-width for readability */}
        <div className="md:max-w-3xl lg:max-w-4xl md:mx-auto md:px-8 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
