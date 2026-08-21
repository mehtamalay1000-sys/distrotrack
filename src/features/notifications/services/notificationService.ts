export type NotificationType = 'picklist' | 'delivery' | 'payment' | 'expense' | 'system';
export type NotificationRecipientRole = 'admin' | 'worker' | 'all';

export interface AppNotification {
  id: string;
  recipient_role: NotificationRecipientRole;
  recipient_worker_id?: string | null;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
  read: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = 'distrotrack_notifications_v1';
const NOTIFICATION_EVENT = 'distrotrack:notification';

function getStoredNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Default initial welcome notifications
      const initial: AppNotification[] = [
        {
          id: 'notif-init-admin-1',
          recipient_role: 'admin',
          title: 'Welcome to DistroTrack',
          message: 'System is ready. Import SAP picklists and monitor deliveries in real-time.',
          type: 'system',
          link: '/admin',
          read: false,
          created_at: new Date().toISOString(),
        },
        {
          id: 'notif-init-worker-1',
          recipient_role: 'worker',
          title: 'Welcome to Worker App',
          message: 'Your route and daily delivery tasks will appear here as soon as they are assigned.',
          type: 'system',
          link: '/w',
          read: false,
          created_at: new Date().toISOString(),
        }
      ];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveNotifications(notifications: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    // Dispatch custom event for cross-component realtime sync
    window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: notifications }));
  } catch (err) {
    console.error('Failed to save notifications:', err);
  }
}

/** Get notifications filtered by user role and workerId */
export function getNotifications(role: 'admin' | 'worker', workerId?: string): AppNotification[] {
  const all = getStoredNotifications();
  return all
    .filter((n) => {
      if (role === 'admin') {
        return n.recipient_role === 'admin' || n.recipient_role === 'all';
      } else {
        if (n.recipient_role === 'admin') return false;
        if (n.recipient_role === 'all') return true;
        // If worker notification is targeted to a specific worker, check matching ID
        if (n.recipient_worker_id && workerId) {
          return n.recipient_worker_id === workerId;
        }
        return true;
      }
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** Get unread count for current user */
export function getUnreadCount(role: 'admin' | 'worker', workerId?: string): number {
  return getNotifications(role, workerId).filter((n) => !n.read).length;
}

/** Add a new notification and notify listeners */
export function addNotification(
  input: Omit<AppNotification, 'id' | 'created_at' | 'read'>
): AppNotification {
  const all = getStoredNotifications();
  const newNotif: AppNotification = {
    ...input,
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    read: false,
    created_at: new Date().toISOString(),
  };

  // Prepend new notification
  all.unshift(newNotif);

  // Keep max 100 notifications to prevent unbounded growth
  if (all.length > 100) {
    all.length = 100;
  }

  saveNotifications(all);
  return newNotif;
}

/** Mark a specific notification as read */
export function markAsRead(id: string): void {
  const all = getStoredNotifications();
  const notif = all.find((n) => n.id === id);
  if (notif && !notif.read) {
    notif.read = true;
    saveNotifications(all);
  }
}

/** Mark all notifications as read for the role */
export function markAllAsRead(role: 'admin' | 'worker', workerId?: string): void {
  const all = getStoredNotifications();
  let modified = false;

  all.forEach((n) => {
    const isTarget = role === 'admin'
      ? (n.recipient_role === 'admin' || n.recipient_role === 'all')
      : (n.recipient_role === 'worker' || n.recipient_role === 'all') && (!n.recipient_worker_id || n.recipient_worker_id === workerId);

    if (isTarget && !n.read) {
      n.read = true;
      modified = true;
    }
  });

  if (modified) {
    saveNotifications(all);
  }
}

/** Delete a single notification */
export function deleteNotification(id: string): void {
  const all = getStoredNotifications();
  const filtered = all.filter((n) => n.id !== id);
  saveNotifications(filtered);
}

/** Clear all notifications for role */
export function clearAllNotifications(role: 'admin' | 'worker', workerId?: string): void {
  const all = getStoredNotifications();
  const remaining = all.filter((n) => {
    const isTarget = role === 'admin'
      ? (n.recipient_role === 'admin' || n.recipient_role === 'all')
      : (n.recipient_role === 'worker' || n.recipient_role === 'all') && (!n.recipient_worker_id || n.recipient_worker_id === workerId);
    return !isTarget;
  });
  saveNotifications(remaining);
}

/** Subscribe to realtime notifications event */
export function subscribeNotifications(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(NOTIFICATION_EVENT, handler);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) callback();
  });
  return () => {
    window.removeEventListener(NOTIFICATION_EVENT, handler);
  };
}
