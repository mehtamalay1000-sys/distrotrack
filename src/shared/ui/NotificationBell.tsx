import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Trash2,
  Package,
  Truck,
  CreditCard,
  Receipt,
  Sparkles,
  ExternalLink,
  X,
  Clock,
} from 'lucide-react';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  subscribeNotifications,
  type AppNotification,
  type NotificationType,
} from '@/features/notifications/services/notificationService';

interface NotificationBellProps {
  role: 'admin' | 'worker';
  workerId?: string;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return 'Recent';
  }
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'picklist':
      return {
        icon: Package,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-100 dark:bg-blue-950/60',
      };
    case 'delivery':
      return {
        icon: Truck,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-100 dark:bg-emerald-950/60',
      };
    case 'payment':
      return {
        icon: CreditCard,
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-100 dark:bg-amber-950/60',
      };
    case 'expense':
      return {
        icon: Receipt,
        color: 'text-purple-600 dark:text-purple-400',
        bg: 'bg-purple-100 dark:bg-purple-950/60',
      };
    case 'system':
    default:
      return {
        icon: Sparkles,
        color: 'text-primary-600 dark:text-primary-400',
        bg: 'bg-primary-100 dark:bg-primary-950/60',
      };
  }
}

export function NotificationBell({ role, workerId }: NotificationBellProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = () => {
    const list = getNotifications(role, workerId);
    setNotifications(list);
    setUnreadCount(getUnreadCount(role, workerId));
  };

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeNotifications(refresh);
    return () => unsubscribe();
  }, [role, workerId]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleNotificationClick = (n: AppNotification) => {
    markAsRead(n.id);
    refresh();
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const handleMarkAllRead = () => {
    markAllAsRead(role, workerId);
    refresh();
  };

  const handleClearAll = () => {
    clearAllNotifications(role, workerId);
    refresh();
  };

  const filteredNotifications = filter === 'unread'
    ? notifications.filter((n) => !n.read)
    : notifications;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        title="Notifications"
        aria-label="Open notifications"
      >
        <Bell className="h-5 w-5" />

        {unreadCount > 0 && (
          <>
            {/* Pulsing indicator ring */}
            <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>

            {/* Numeric badge */}
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-red-500 rounded-full shadow-sm ring-2 ring-white dark:ring-surface-900">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </>
        )}
      </button>

      {/* Popover Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-3.5 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between bg-surface-50/80 dark:bg-surface-800/60 backdrop-blur-xs">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100 flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-semibold bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-950/40 transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-surface-100 dark:border-surface-800 px-3 pt-1.5 bg-surface-50/40 dark:bg-surface-800/30">
            <button
              onClick={() => setFilter('all')}
              className={`pb-1.5 text-xs font-semibold px-2 border-b-2 transition-colors ${
                filter === 'all'
                  ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`pb-1.5 text-xs font-semibold px-2 border-b-2 transition-colors ${
                filter === 'unread'
                  ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-surface-100 dark:divide-surface-800/60">
            {filteredNotifications.length > 0 ? (
              filteredNotifications.map((n) => {
                const iconInfo = getNotificationIcon(n.type);
                const IconComponent = iconInfo.icon;

                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer group ${
                      !n.read
                        ? 'bg-primary-50/40 dark:bg-primary-950/20 hover:bg-primary-50/70 dark:hover:bg-primary-950/30'
                        : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                    }`}
                  >
                    {/* Category Icon */}
                    <div
                      className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconInfo.bg} ${iconInfo.color} shadow-xs`}
                    >
                      <IconComponent className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4
                          className={`text-xs font-semibold truncate ${
                            !n.read
                              ? 'text-surface-900 dark:text-surface-100'
                              : 'text-surface-700 dark:text-surface-300'
                          }`}
                        >
                          {n.title}
                        </h4>
                        {!n.read && (
                          <span className="h-2 w-2 rounded-full bg-primary-600 dark:bg-primary-400 flex-shrink-0" />
                        )}
                      </div>

                      <p className="text-xs text-surface-600 dark:text-surface-400 line-clamp-2 leading-relaxed">
                        {n.message}
                      </p>

                      <div className="flex items-center justify-between mt-1.5 text-[10px] text-surface-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(n.created_at)}
                        </span>

                        {n.link && (
                          <span className="text-primary-600 dark:text-primary-400 font-medium flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            View <ExternalLink className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Delete action */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n.id);
                        refresh();
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-surface-400 hover:text-red-500 rounded transition-all"
                      title="Dismiss"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center">
                <div className="h-12 w-12 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-2 text-surface-400">
                  <Bell className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                  No notifications
                </p>
                <p className="text-xs text-surface-400 mt-0.5">
                  {filter === 'unread'
                    ? "You've read all your notifications!"
                    : 'New updates and activity will appear here.'}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-2.5 border-t border-surface-100 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-800/40 flex justify-between items-center text-xs">
              <span className="text-[11px] text-surface-400">
                {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={handleClearAll}
                className="text-[11px] text-surface-500 hover:text-red-600 dark:text-surface-400 dark:hover:text-red-400 font-medium transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
