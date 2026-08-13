import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-surface-900 dark:text-white tracking-tight">{title}</h1>
        {description && <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  change?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ label, value, icon, change, className = '' }: StatCardProps) {
  return (
    <div className={`bg-white dark:bg-surface-850 dark:bg-surface-800 border border-surface-200 dark:border-surface-700/80 rounded-xl p-4 shadow-xs ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wide">{label}</span>
        {icon && <div className="text-surface-400 dark:text-surface-400">{icon}</div>}
      </div>
      <div className="text-2xl font-semibold text-surface-900 dark:text-surface-50">{value}</div>
      {change && (
        <p className={`text-xs mt-1 ${change.positive ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
          {change.positive ? '↑' : '↓'} {change.value}
        </p>
      )}
    </div>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div className={`bg-white dark:bg-surface-850 dark:bg-surface-800 border border-surface-200 dark:border-surface-700/80 rounded-xl ${padding ? 'p-5' : ''} ${className}`}>
      {children}
    </div>
  );
}
