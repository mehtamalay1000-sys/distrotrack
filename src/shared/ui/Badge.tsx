type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300',
  success: 'bg-success-50 dark:bg-success-950/50 text-success-700 dark:text-success-400',
  warning: 'bg-warning-50 dark:bg-warning-950/50 text-warning-600 dark:text-warning-400',
  danger: 'bg-danger-50 dark:bg-danger-950/50 text-danger-600 dark:text-danger-400',
  info: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300',
  neutral: 'bg-surface-100 dark:bg-surface-700/60 text-surface-600 dark:text-surface-300',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  );
}

// Convenience component for status displays
interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusMap: Record<string, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'neutral' },
  draft: { label: 'Draft', variant: 'neutral' },
  confirmed: { label: 'Confirmed', variant: 'info' },
  assigned: { label: 'Assigned', variant: 'default' },
  in_progress: { label: 'In Progress', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  out_for_delivery: { label: 'Out for Delivery', variant: 'info' },
  delivered: { label: 'Delivered', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  collected: { label: 'Collected', variant: 'success' },
  bounced: { label: 'Bounced', variant: 'danger' },
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Partial', variant: 'warning' },
  cash: { label: 'Cash', variant: 'success' },
  cheque: { label: 'Cheque', variant: 'info' },
  upi: { label: 'UPI', variant: 'default' },
  credit: { label: 'Credit/Udhari', variant: 'warning' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const mapped = statusMap[status] || { label: status, variant: 'neutral' as BadgeVariant };
  return <Badge variant={mapped.variant} className={className}>{mapped.label}</Badge>;
}
