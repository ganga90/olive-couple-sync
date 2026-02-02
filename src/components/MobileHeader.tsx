import React from 'react';
import { Link } from 'react-router-dom';
import { Settings, Bell } from 'lucide-react';
import { PartnerAvatar } from './PartnerAvatar';
import { OliveLogoWithText } from './OliveLogo';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useLocalizedHref } from '@/hooks/useLocalizedNavigate';
import { cn } from '@/lib/utils';
import { NotificationsCenter } from '@/components/notifications';

export const MobileHeader = () => {
  const { partner } = useSupabaseCouple();
  const getLocalizedPath = useLocalizedHref();

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-40",
        "bg-background/95 backdrop-blur-lg supports-[backdrop-filter]:bg-background/80",
        "border-b border-border/50"
      )}
      style={{
        // Respect iOS safe area inset for notch/Dynamic Island
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 min-h-[56px]">
        {/* Left: Partner Avatar with white ring - now larger with proper touch target */}
        <div className="w-11 flex items-center">
          {partner ? (
            <PartnerAvatar
              name={partner}
              isActive={false}
              lastActiveMinutesAgo={undefined}
              className="[&>div]:ring-white [&>div]:ring-offset-background"
            />
          ) : (
            <div className="w-8 h-8" />
          )}
        </div>

        {/* Center: Olive Logo */}
        <Link to={getLocalizedPath("/home")} className="flex-shrink-0">
          <OliveLogoWithText size="sm" />
        </Link>

        {/* Right: Notifications + Settings Icons with 44x44pt touch targets */}
        <div className="flex items-center gap-1">
          {/* Notifications Bell */}
          <NotificationsCenter
            trigger={
              <button
                className={cn(
                  "flex items-center justify-center",
                  "w-11 h-11 rounded-full",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-muted/50 active:bg-muted/70",
                  "transition-all duration-200"
                )}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
              </button>
            }
          />

          {/* Settings */}
          <Link
            to={getLocalizedPath("/profile")}
            className={cn(
              "flex items-center justify-center",
              "w-11 h-11 rounded-full",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-muted/50 active:bg-muted/70",
              "transition-all duration-200"
            )}
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </header>
  );
};
