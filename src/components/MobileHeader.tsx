import React from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { PartnerAvatar } from './PartnerAvatar';
import { OliveLogoWithText } from './OliveLogo';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useLocalizedHref } from '@/hooks/useLocalizedNavigate';

export const MobileHeader = () => {
  const { partner } = useSupabaseCouple();
  const getLocalizedPath = useLocalizedHref();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pt-[env(safe-area-inset-top)]">
      {/* Main header row - pushed below safe area with additional spacing */}
      <div className="flex items-center justify-between px-4 py-3 min-h-[56px]">
        {/* Left: Partner Avatar - larger touch target */}
        <Link 
          to={getLocalizedPath("/profile")}
          className="flex items-center justify-center w-11 h-11 -ml-1 rounded-full hover:bg-muted/50 transition-colors"
          aria-label="Partner profile"
        >
          {partner ? (
            <div className="ring-2 ring-white rounded-full shadow-sm">
              <PartnerAvatar
                name={partner}
                isActive={false}
                lastActiveMinutesAgo={undefined}
              />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-muted" />
          )}
        </Link>

        {/* Center: Olive Logo */}
        <Link to={getLocalizedPath("/home")} className="flex-shrink-0">
          <OliveLogoWithText size="sm" />
        </Link>

        {/* Right: Settings - larger touch target */}
        <Link 
          to={getLocalizedPath("/profile")} 
          className="flex items-center justify-center w-11 h-11 -mr-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
};
