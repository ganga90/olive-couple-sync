/**
 * NotificationsCenter Component
 * ============================================================================
 * Feature 3: Daily Pulse
 *
 * Centralized notification hub displaying:
 * - Price drop alerts from wishlist
 * - Important date reminders
 * - Weekend activity suggestions
 * - Stale task cleanup prompts
 * - Budget warnings
 * 
 * NOTE: This component currently uses local state only as the 
 * 'notifications' table is not yet created in the database.
 * TODO: Create notifications table and connect to Supabase
 */

import React, { useState, useMemo } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { formatDistanceToNow } from 'date-fns';
import {
  Bell,
  DollarSign,
  Heart,
  Sun,
  Archive,
  AlertTriangle,
  X,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  action_url?: string;
  priority: number;
  is_read: boolean;
  is_dismissed: boolean;
  is_actioned: boolean;
  source_type?: string;
  source_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  expires_at?: string;
}

type NotificationType = 'all' | 'price_drop' | 'date_reminder' | 'weather_suggestion' | 'stale_task' | 'budget_warning' | 'budget_exceeded';

// ============================================================================
// NOTIFICATION TYPE CONFIG
// ============================================================================

const notificationConfig: Record<string, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  label: string;
}> = {
  price_drop: {
    icon: DollarSign,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: 'Price Drop'
  },
  date_reminder: {
    icon: Heart,
    color: 'text-pink-600',
    bgColor: 'bg-pink-100',
    label: 'Date Reminder'
  },
  weather_suggestion: {
    icon: Sun,
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
    label: 'Weekend Idea'
  },
  stale_task: {
    icon: Archive,
    color: 'text-slate-600',
    bgColor: 'bg-slate-100',
    label: 'Task Cleanup'
  },
  budget_warning: {
    icon: AlertTriangle,
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
    label: 'Budget Warning'
  },
  budget_exceeded: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    label: 'Budget Exceeded'
  }
};

const getNotificationConfig = (type: string) => {
  return notificationConfig[type] || {
    icon: Bell,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: 'Notification'
  };
};

// ============================================================================
// NOTIFICATION ITEM COMPONENT
// ============================================================================

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onAction: (notification: Notification) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkRead,
  onDismiss,
  onAction
}) => {
  const config = getNotificationConfig(notification.type);
  const Icon = config.icon;

  const timeAgo = formatDistanceToNow(new Date(notification.created_at), { addSuffix: true });

  const handleClick = () => {
    if (!notification.is_read) {
      onMarkRead(notification.id);
    }
    onAction(notification);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 transition-colors cursor-pointer",
        !notification.is_read && "bg-primary/5",
        "hover:bg-muted/50"
      )}
      onClick={handleClick}
    >
      {/* Icon */}
      <div className={cn(
        "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
        config.bgColor
      )}>
        <Icon className={cn("w-5 h-5", config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn(
                "font-medium text-sm",
                !notification.is_read && "font-semibold"
              )}>
                {notification.title}
              </p>
              {!notification.is_read && (
                <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
              )}
            </div>

            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
              {notification.message}
            </p>

            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-xs">
                {config.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{timeAgo}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {notification.action_url && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(notification.action_url, '_blank');
                }}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(notification.id);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// NOTIFICATION GROUP COMPONENT
// ============================================================================

interface NotificationGroupProps {
  title: string;
  icon: React.ElementType;
  color: string;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onAction: (notification: Notification) => void;
}

const NotificationGroup: React.FC<NotificationGroupProps> = ({
  title,
  icon: Icon,
  color,
  notifications,
  onMarkRead,
  onDismiss,
  onAction
}) => {
  if (notifications.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 px-4 mb-2">
        <Icon className={cn("w-4 h-4", color)} />
        <h3 className="font-medium text-sm">{title}</h3>
        <Badge variant="secondary" className="text-xs">
          {notifications.length}
        </Badge>
      </div>

      <div className="divide-y">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkRead={onMarkRead}
            onDismiss={onDismiss}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export interface NotificationsCenterProps {
  triggerClassName?: string;
  trigger?: React.ReactNode;
}

export const NotificationsCenter: React.FC<NotificationsCenterProps> = ({
  triggerClassName,
  trigger
}) => {
  const { user } = useAuth();
  // Using local state only - notifications table not yet in database
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationType>('all');

  // Computed values
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.is_read).length,
    [notifications]
  );

  const grouped = useMemo(() => ({
    priceDrops: notifications.filter(n => n.type === 'price_drop'),
    dateReminders: notifications.filter(n => n.type === 'date_reminder'),
    weekendSuggestions: notifications.filter(n => n.type === 'weather_suggestion'),
    staleTasks: notifications.filter(n => n.type === 'stale_task'),
    budgetAlerts: notifications.filter(n => n.type === 'budget_warning' || n.type === 'budget_exceeded'),
  }), [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter(n => n.type === activeTab);
  }, [notifications, activeTab]);

  // Actions (local state only for now)
  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    toast.success('Notification dismissed');
  };

  const markAllAsRead = () => {
    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: true }))
    );
    toast.success('All notifications marked as read');
  };

  const dismissAll = () => {
    setNotifications([]);
    toast.success('All notifications dismissed');
  };

  const handleNotificationAction = (notification: Notification) => {
    // Handle different notification types
    switch (notification.type) {
      case 'price_drop':
        if (notification.action_url) {
          window.open(notification.action_url, '_blank');
        }
        break;
      case 'date_reminder':
        // Could navigate to calendar or date details
        break;
      case 'weather_suggestion':
        // Could navigate to the suggested activity
        break;
      case 'stale_task':
        // Could navigate to task list
        break;
      default:
        break;
    }
  };

  // Default trigger button with badge
  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className={cn("relative", triggerClassName)}
    >
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge
          className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1.5 rounded-full text-xs"
          variant="destructive"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="secondary">{unreadCount} unread</Badge>
              )}
            </SheetTitle>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Bulk Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={markAllAsRead}>
                  Mark all as read
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={dismissAll}
                  className="text-destructive"
                >
                  Dismiss all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>
            Stay updated with price drops, reminders, and more
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as NotificationType)}>
          <div className="px-4 pt-2">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="price_drop">Deals</TabsTrigger>
              <TabsTrigger value="budget_warning">Budget</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={activeTab} className="m-0">
            <ScrollArea className="h-[calc(100vh-200px)]">
              {filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <Bell className="w-12 h-12 text-muted-foreground/50 mb-4" />
                  <h3 className="font-medium text-lg">All caught up!</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    No notifications at the moment
                  </p>
                </div>
              ) : activeTab === 'all' ? (
                // Grouped view for "All" tab
                <div className="py-2">
                  <NotificationGroup
                    title="Price Drops"
                    icon={DollarSign}
                    color="text-green-600"
                    notifications={grouped.priceDrops}
                    onMarkRead={markAsRead}
                    onDismiss={dismissNotification}
                    onAction={handleNotificationAction}
                  />
                  <NotificationGroup
                    title="Date Reminders"
                    icon={Heart}
                    color="text-pink-600"
                    notifications={grouped.dateReminders}
                    onMarkRead={markAsRead}
                    onDismiss={dismissNotification}
                    onAction={handleNotificationAction}
                  />
                  <NotificationGroup
                    title="Weekend Ideas"
                    icon={Sun}
                    color="text-amber-600"
                    notifications={grouped.weekendSuggestions}
                    onMarkRead={markAsRead}
                    onDismiss={dismissNotification}
                    onAction={handleNotificationAction}
                  />
                  <NotificationGroup
                    title="Budget Alerts"
                    icon={AlertTriangle}
                    color="text-red-600"
                    notifications={grouped.budgetAlerts}
                    onMarkRead={markAsRead}
                    onDismiss={dismissNotification}
                    onAction={handleNotificationAction}
                  />
                  <NotificationGroup
                    title="Task Cleanup"
                    icon={Archive}
                    color="text-slate-600"
                    notifications={grouped.staleTasks}
                    onMarkRead={markAsRead}
                    onDismiss={dismissNotification}
                    onAction={handleNotificationAction}
                  />
                </div>
              ) : (
                // Flat list for filtered tabs
                <div className="divide-y">
                  {filteredNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={markAsRead}
                      onDismiss={dismissNotification}
                      onAction={handleNotificationAction}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationsCenter;
