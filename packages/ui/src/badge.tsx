import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm bg-neutral-200 px-1 py-0.5 text-caption text-neutral-800',
        className,
      )}
    >
      {children}
    </span>
  );
}
