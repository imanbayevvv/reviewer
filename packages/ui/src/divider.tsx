import { clsx } from 'clsx';

interface DividerProps {
  className?: string;
}

export function Divider({ className }: DividerProps) {
  return <hr className={clsx('border-t border-[rgba(0,0,0,0.1)]', className)} />;
}
