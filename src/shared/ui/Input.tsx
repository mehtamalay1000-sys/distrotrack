import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className = '', ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-surface-700 dark:text-surface-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`block w-full h-9 px-3 text-sm border rounded-lg transition-colors bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100
            ${error ? 'border-danger-500 focus:ring-danger-500/40' : 'border-surface-300 dark:border-surface-700 focus:ring-primary-500/40'}
            focus:outline-none focus:ring-2 focus:ring-offset-1
            placeholder:text-surface-400 dark:placeholder:text-surface-500 disabled:opacity-50 disabled:bg-surface-50 dark:disabled:bg-surface-900
            ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}
        {hint && !error && <p className="text-xs text-surface-500 dark:text-surface-400">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
