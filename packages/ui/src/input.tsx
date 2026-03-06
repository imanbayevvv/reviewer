import { clsx } from 'clsx';
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-body-lg text-neutral-600">{label}</label>
      )}
      <input
        ref={ref}
        className={clsx(
          'h-10 rounded-lg border px-4 text-body-md bg-white outline-none transition-colors',
          'placeholder:text-neutral-400',
          error
            ? 'border-red-500 focus:border-red-500'
            : 'border-[rgba(0,0,0,0.1)] focus:border-[rgba(0,0,0,0.5)]',
          className,
        )}
        {...props}
      />
      {error && <span className="text-body-sm text-red-500">{error}</span>}
    </div>
  ),
);
Input.displayName = 'Input';
