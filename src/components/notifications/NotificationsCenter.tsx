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
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Bell,
  DollarSign,
  Heart,
  Sun,
  Archive,
  AlertTriangle,
  Check,
  X,
  ChevronRight,
  ExternalLink,
  Trash2,
  Filter,
  RefreshCw
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

interface Notification {
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
  metadata?: Record<string, any>;
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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationType>('all');

  // Fetch notifications
  useEffect(() => {
    if (!user?.id || !open) return;

    const fetchNotifications = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_dismissed', false)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setNotifications(data || []);
      } catch (error) {
        console.error('Error fetching notifications:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();
  }, [user?.id, open]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          setNotifications(prev => [payload.new as Notification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

  // Actions
  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const dismissNotification = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_dismissed: true })
        .eq('id', id);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== id));
      toast.success('Notification dismissed');
    } catch (error) {
      console.error('Error dismissing notification:', error);
      toast.error('Failed to dismiss notification');
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user?.id)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true }))
      );

      toast.success('All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      toast.error('Failed to mark all as read');
    }
  };

  const dismissAll = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_dismissed: true })
        .eq('user_id', user?.id)
        .eq('is_dismissed', false);

      if (error) throw error;

      setNotifications([]);
      toast.success('All notifications dismissed');
    } catch (error) {
      console.error('Error dismissing all:', error);
      toast.error('Failed to dismiss all notifications');
    }
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
        if (notification.metadata?.note_id) {
          // Navigate to note
        }
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

  // Custom trigger with badge overlay
  const triggerWithBadge = trigger ? (
    <div className="relative inline-flex">
      {trigger}
      {unreadCount > 0 && (
        <Badge
          className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1.5 rounded-full text-xs pointer-events-none"
          variant="destructive"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </div>
  ) : defaultTrigger;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {triggerWithBadge}
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-lg p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Notifications</SheetTitle>
              <SheetDescription>
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
                  : 'All caught up!'
                }
              </SheetDescription>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Filter className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={markAllAsRead}>
                  <Check className="w-4 h-4 mr-2" />
                  Mark all as read
                </DropdownMenuItem>
                <DropdownMenuItem onClick={dismissAll} className="text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Dismiss all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetHeader>

        {/* Filter Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as NotificationType)} className="w-full">
          <div className="border-b px-4">
            <TabsList className="h-12 w-full justify-start bg-transparent p-0 gap-4">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-3"
              >
                All ({notifications.length})
              </TabsTrigger>
              {grouped.priceDrops.length > 0 && (
                <TabsTrigger
                  value="price_drop"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-3"
                >
                  <DollarSign className="w-4 h-4 mr-1" />
                  {grouped.priceDrops.length}
                </TabsTrigger>
              )}
              {grouped.dateReminders.length > 0 && (
                <TabsTrigger
                  value="date_reminder"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-3"
                >
                  <Heart className="w-4 h-4 mr-1" />
                  {grouped.dateReminders.length}
                </TabsTrigger>
              )}
              {grouped.budgetAlerts.length > 0 && (
                <TabsTrigger
                  value="budget_warning"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-3"
                >
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  {grouped.budgetAlerts.length}
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value={activeTab} className="m-0">
            <ScrollArea className="h-[calc(100vh-180px)]">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <Bell className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h3 className="font-medium text-muted-foreground">No notifications</h3>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    You're all caught up!
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
                    title="Upcoming Dates"
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
                // Flat list for filtered views
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
