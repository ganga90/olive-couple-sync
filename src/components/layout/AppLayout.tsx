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

  // Desktop layout: Sidebar + Floating Sheet on Stone Desk
  return (
    <div className="flex min-h-screen bg-[hsl(40_20%_88%)]">
      {/* Fixed Left Sidebar - 280px - blends with stone background */}
      <DesktopSidebar />
      
      {/* Main Content Area - "FLOATING SHEET OF PAPER" */}
      <main className="flex-1 ml-72 py-6 pr-6 xl:pr-8">
        {/* Paper Surface - Floating sheet with shadow, rounded top */}
        <div className="bg-[hsl(48_60%_99%)] rounded-3xl shadow-2xl min-h-[calc(100vh-3rem)] overflow-hidden">
          {/* Central Focus Container - max-w-3xl (768px) centered */}
          <div className="max-w-3xl mx-auto px-8 lg:px-12 pt-12 lg:pt-16 pb-12">
            {children}
          </div>
        </div>
      </main>
      
      {/* Context Rail - Optional right column for xl screens */}
      <aside className="hidden xl:block w-80 py-6 pr-6 shrink-0">
        {/* This space can be used for Partner Status, Mini Calendar, etc. */}
        {/* Currently empty - transparent on stone background */}
      </aside>
    </div>
  );
};

export default AppLayout;
