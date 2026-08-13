import { Loader2, FileQuestion, AlertTriangle } from 'lucide-react';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-surface-400">
      <Loader2 className="h-8 w-8 animate-spin mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-surface-300">
        {icon || <FileQuestion className="h-10 w-10" />}
      </div>
      <h3 className="text-sm font-medium text-surface-700 mb-1">{title}</h3>
      {description && <p className="text-xs text-surface-500 max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  retry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, retry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-danger-500 mb-3" />
      <h3 className="text-sm font-medium text-surface-700 mb-1">{title}</h3>
      <p className="text-xs text-surface-500 max-w-sm mb-4">{message}</p>
      {retry && (
        <button onClick={retry} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
          Try again
        </button>
      )}
    </div>
  );
}
