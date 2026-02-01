import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface PartnerAvatarProps {
  name?: string;
  imageUrl?: string;
  isActive?: boolean;
  lastActiveMinutesAgo?: number;
  className?: string;
}

export const PartnerAvatar: React.FC<PartnerAvatarProps> = ({
  name,
  imageUrl,
  isActive = false,
  lastActiveMinutesAgo,
  className
}) => {
  const getInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getStatusColor = () => {
    if (isActive) return 'ring-[hsl(var(--status-active))]';
    return 'ring-[hsl(var(--status-offline))]';
  };

  const getTooltipText = () => {
    if (!name) return 'No partner';
    if (isActive) return `${name} (Active)`;
    if (lastActiveMinutesAgo !== undefined) {
      if (lastActiveMinutesAgo < 60) {
        return `${name} (${lastActiveMinutesAgo}m ago)`;
      }
      const hours = Math.floor(lastActiveMinutesAgo / 60);
      return `${name} (${hours}h ago)`;
    }
    return `${name} (Offline)`;
  };

  return (
    <div className={cn("relative", className)} title={getTooltipText()}>
      <Avatar className={cn(
        // Slightly larger avatar for better visibility
        "h-9 w-9",
        // White border ring for premium look that pops against any background
        "ring-2 ring-white ring-offset-2 ring-offset-background",
        // Subtle shadow for depth
        "shadow-sm",
        "transition-all duration-200"
      )}>
        {imageUrl && <AvatarImage src={imageUrl} alt={name || 'Partner'} />}
        <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      {/* Status indicator dot */}
      {isActive && (
        <div className={cn(
          "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full",
          "bg-[hsl(var(--status-active))]",
          "border-2 border-white",
          "shadow-sm"
        )} />
      )}
    </div>
  );
};
