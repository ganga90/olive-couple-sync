import React from 'react';
import { useLocation } from 'react-router-dom';
import { MobileHeader } from './MobileHeader';
import MobileTabBar from './MobileTabBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLanguage } from '@/providers/LanguageProvider';

interface MobileLayoutProps {
  children: React.ReactNode;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children }) => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const { stripLocalePath } = useLanguage();
  
  // Get the path without locale prefix for route matching
  const cleanPath = stripLocalePath(location.pathname);
  
  // Routes that should hide the mobile layout
  const hideLayoutRoutes = [
    '/landing',
    '/sign-in',
    '/sign-up',
    '/onboarding',
    '/welcome',
    '/'
  ];
  
  const shouldHideLayout = hideLayoutRoutes.includes(cleanPath);
  
  // Main app routes with mobile header and bottom tabs
  const mainAppRoutes = ['/home', '/lists', '/calendar', '/reminders', '/profile'];
  const isMainAppRoute = mainAppRoutes.includes(cleanPath) || 
    cleanPath.startsWith('/lists/') || 
    cleanPath.startsWith('/notes/');

  if (shouldHideLayout) {
    return <>{children}</>;
  }

  if (!isMobile || !isMainAppRoute) {
    // Desktop or other pages - just show children
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Fixed Header */}
      <MobileHeader />
      
      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden pt-[57px] pb-[73px]">
        {children}
      </main>
      
      {/* Fixed Bottom Tab Bar */}
      <MobileTabBar />
    </div>
  );
};
