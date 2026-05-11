'use client';

import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';
export type NotificationSource =
  | 'scpi'
  | 'websocket'
  | 'gate'
  | 'system'
  | 'user';

export interface Notification {
  id: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  title: string;
  message: string;
  timestamp: number;
  testId?: string;
  read?: boolean;
}

interface NotificationsContextValue {
  items: Notification[];
  unreadCount: number;
  push: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAllRead: () => void;
  clear: () => void;
  remove: (id: string) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const MAX_ITEMS = 200;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const counterRef = useRef(0);

  const push = useCallback<NotificationsContextValue['push']>((n) => {
    counterRef.current += 1;
    const entry: Notification = {
      ...n,
      id: `${Date.now()}-${counterRef.current}`,
      timestamp: Date.now(),
      read: false,
    };
    setItems(prev => {
      const next = [entry, ...prev];
      return next.length > MAX_ITEMS ? next.slice(0, MAX_ITEMS) : next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems(prev => prev.map(i => (i.read ? i : { ...i, read: true })));
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const remove = useCallback(
    (id: string) => setItems(prev => prev.filter(i => i.id !== id)),
    [],
  );

  const value = useMemo<NotificationsContextValue>(() => ({
    items,
    unreadCount: items.reduce((n, i) => n + (i.read ? 0 : 1), 0),
    push, markAllRead, clear, remove,
  }), [items, push, markAllRead, clear, remove]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return ctx;
}
