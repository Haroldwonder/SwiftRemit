import { useState, useCallback, useEffect, useRef } from 'react';

import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, 0 = persistent
}

const ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
};

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  error: 5000,
  success: 3000,
  info: 4000,
  warning: 4000,
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const duration = toast.duration ?? DEFAULT_DURATION[toast.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(duration);
  const startRef = useRef<number>(0);

  const startTimer = useCallback(() => {
    if (duration <= 0) return;
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(toast.id), remainingRef.current);
  }, [duration, toast.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startRef.current;
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [startTimer]);

  return (
    <div
      className={`toast ${toast.type}`}
      role="alert"
      aria-live="polite"
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <span className="toast-icon" aria-hidden="true">{ICONS[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export interface UseToastReturn {
  toasts: ToastMessage[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
  }, []);

  return { toasts, showToast, dismissToast };
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
