import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, id, className = '', ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-surface-700 dark:text-surface-300">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`block w-full h-9 px-3 text-sm border rounded-lg transition-colors bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100
            ${error ? 'border-danger-500 focus:ring-danger-500/40' : 'border-surface-300 dark:border-surface-700 focus:ring-primary-500/40'}
            focus:outline-none focus:ring-2 focus:ring-offset-1
            disabled:opacity-50 disabled:bg-surface-50 dark:disabled:bg-surface-900
            ${className}`}
          {...props}
        >
          {placeholder && <option value="" className="bg-white dark:bg-surface-800">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100">{o.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
