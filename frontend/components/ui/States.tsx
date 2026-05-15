'use client';

/**
 * Consistent empty / loading / error state primitives. Used by lists,
 * tables and dashboard cards so the visual treatment is uniform across
 * every route.
 */
import React from 'react';
import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react';

interface StateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title = 'Nothing here yet', description, action, className }: StateProps) {
  return (
    <div
      role="status"
      data-testid="state-empty"
      className={`flex flex-col items-center justify-center text-center py-10 px-6 border border-dashed border-app rounded-lg bg-surface ${className ?? ''}`}
    >
      <Inbox className="w-8 h-8 text-muted mb-2" aria-hidden />
      <p className="text-sm font-medium text-app">{title}</p>
      {description && <p className="text-xs text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function LoadingState({
  title = 'Loading…',
  description,
  className,
}: StateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="state-loading"
      className={`flex flex-col items-center justify-center text-center py-10 px-6 ${className ?? ''}`}
    >
      <Loader2 className="w-6 h-6 text-muted animate-spin mb-2" aria-hidden />
      <p className="text-sm font-medium text-app">{title}</p>
      {description && <p className="text-xs text-muted mt-1 max-w-sm">{description}</p>}
    </div>
  );
}

interface ErrorStateProps extends StateProps {
  error?: Error | string | null;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  error,
  onRetry,
  className,
}: ErrorStateProps) {
  const message =
    description ??
    (typeof error === 'string' ? error : error?.message) ??
    'The request failed. Please try again.';
  return (
    <div
      role="alert"
      data-testid="state-error"
      className={`flex flex-col items-center justify-center text-center py-10 px-6 border border-red-700/50 bg-red-950/30 rounded-lg ${className ?? ''}`}
    >
      <AlertTriangle className="w-8 h-8 text-red-300 mb-2" aria-hidden />
      <p className="text-sm font-medium text-red-200">{title}</p>
      <p className="text-xs text-red-300/80 mt-1 max-w-sm break-words">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-900/50 hover:bg-red-900/80 border border-red-700/60 text-red-100 text-xs"
        >
          <RotateCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * Convenience renderer: pick one of the three states based on a tuple
 * of {isLoading, error, isEmpty, children}. Saves the ?:?:? boilerplate
 * at every consumer.
 */
interface LoadStateGateProps {
  loading?: boolean;
  error?: Error | string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  loadingTitle?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function LoadStateGate({
  loading,
  error,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  loadingTitle,
  onRetry,
  children,
}: LoadStateGateProps) {
  if (loading) return <LoadingState title={loadingTitle} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  return <>{children}</>;
}
