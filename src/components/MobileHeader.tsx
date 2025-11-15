import React from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { PartnerAvatar } from './PartnerAvatar';
import { OliveLogoWithText } from './OliveLogo';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';

export const MobileHeader = () => {
  const { partner } = useSupabaseCouple();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: Partner Avatar */}
        <div className="w-10">
          {partner && (
            <PartnerAvatar
              name={partner}
              isActive={false}
              lastActiveMinutesAgo={undefined}
            />
          )}
        </div>

        {/* Center: Olive Logo */}
        <Link to="/home" className="flex-shrink-0">
          <OliveLogoWithText size="sm" />
        </Link>

        {/* Right: Settings */}
        <Link 
          to="/profile" 
          className="w-10 flex items-center justify-end text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
};
