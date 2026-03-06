import { clsx } from 'clsx';

interface StepperProps {
  current: number;
  total: number;
  className?: string;
}

export function Stepper({ current, total, className }: StepperProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-xl border border-[rgba(0,0,0,0.3)] px-3 py-1 text-body-lg',
        className,
      )}
    >
      Step {current} of {total}
    </span>
  );
}
