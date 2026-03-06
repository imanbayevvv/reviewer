import { clsx } from 'clsx';
import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'white' | 'surface';
}

export function Card({ variant = 'white', className, children, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-xl p-6',
        variant === 'white' ? 'bg-white' : 'bg-surface',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
