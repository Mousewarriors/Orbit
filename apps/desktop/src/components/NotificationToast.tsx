import { useCallback, useEffect, useRef, useState } from 'react';
import * as native from '../native.js';
import { recordString, type RelayObject } from '../relayViewModel.js';

export interface Notification {
  readonly id: string;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly timestamp: number;
}

const MAX_VISIBLE = 3;
const DISMISS_MS = 6000;

const NOTIFY_EVENT_TYPES = new Set([
  'session_started', 'session_stopped', 'session_error',
  'launch_complete', 'launch_failed',
  'handoff_created', 'handoff_validated',
  'approval_request', 'approval_timeout',
  'error', 'critical',
]);

function shouldNotify(event: RelayObject): boolean {
  const type = (recordString(event, 'type') ?? recordString(event, 'kind') ?? '').toLowerCase();
  if (NOTIFY_EVENT_TYPES.has(type)) return true;
  const level = (recordString(event, 'level') ?? recordString(event, 'severity') ?? '').toLowerCase();
  return level === 'error' || level === 'critical';
}

function eventToNotification(event: RelayObject): Notification {
  const type = (recordString(event, 'type') ?? recordString(event, 'kind') ?? 'event').toLowerCase();
  const summary = recordString(event, 'summary') ?? recordString(event, 'message') ?? type;
  const level = (recordString(event, 'level') ?? recordString(event, 'severity') ?? '').toLowerCase();
  let severity: Notification['severity'] = 'info';
  if (level === 'error' || level === 'critical' || type.includes('error') || type.includes('failed')) {
    severity = 'error';
  } else if (level === 'warning' || level === 'warn' || type.includes('timeout')) {
    severity = 'warning';
  }
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: summary,
    severity,
    timestamp: Date.now(),
  };
}

export interface NotificationConfig {
  readonly enabled: boolean;
  readonly maxVisible: number;
  readonly dismissMs: number;
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  maxVisible: MAX_VISIBLE,
  dismissMs: DISMISS_MS,
};

const NOTIFICATION_SETTING_KEY = 'orbit.notifications.config';

export function useNotifications(): {
  notifications: readonly Notification[];
  config: NotificationConfig;
  dismiss: (id: string) => void;
  setEnabled: (enabled: boolean) => void;
} {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const seenEvents = useRef(new Set<string>());

  useEffect(() => {
    if (!native.isTauri()) return;
    void native.getSetting(NOTIFICATION_SETTING_KEY).then((stored) => {
      if (!stored) return;
      try {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          setConfig({
            enabled: typeof obj['enabled'] === 'boolean' ? obj['enabled'] : DEFAULT_CONFIG.enabled,
            maxVisible: typeof obj['maxVisible'] === 'number' ? obj['maxVisible'] : DEFAULT_CONFIG.maxVisible,
            dismissMs: typeof obj['dismissMs'] === 'number' ? obj['dismissMs'] : DEFAULT_CONFIG.dismissMs,
          });
        }
      } catch { /* use defaults */ }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!native.isTauri() || !config.enabled) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const payload = await native.relayListEvents();
        if (cancelled) return;
        const events = (payload as Record<string, unknown>)['events'];
        if (!Array.isArray(events)) return;
        for (const event of events as RelayObject[]) {
          const eventId = recordString(event, 'id') ?? recordString(event, 'eventId') ?? '';
          if (!eventId || seenEvents.current.has(eventId)) continue;
          seenEvents.current.add(eventId);
          if (shouldNotify(event)) {
            const notification = eventToNotification(event);
            setNotifications((prev) => [notification, ...prev].slice(0, config.maxVisible));
          }
        }
      } catch { /* non-fatal */ }
    };
    const interval = setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [config.enabled, config.maxVisible]);

  // Auto-dismiss
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications((prev) => prev.slice(0, -1));
    }, config.dismissMs);
    return () => clearTimeout(timer);
  }, [notifications, config.dismissMs]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    const next = { ...config, enabled };
    setConfig(next);
    if (native.isTauri()) {
      void native.setSetting(NOTIFICATION_SETTING_KEY, JSON.stringify(next)).catch(() => {});
    }
  }, [config]);

  return { notifications, config, dismiss, setEnabled };
}

export function NotificationToast({
  notifications,
  onDismiss,
}: {
  readonly notifications: readonly Notification[];
  readonly onDismiss: (id: string) => void;
}): JSX.Element | null {
  if (notifications.length === 0) return null;
  return (
    <div className="orbit-notifications" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`orbit-notification orbit-notification-${n.severity}`}>
          <span>{n.message}</span>
          <button
            className="orbit-notification-dismiss"
            onClick={() => onDismiss(n.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
