import { clsx } from 'clsx';

interface ProgressLoaderProps {
  label: string;
  completedSteps?: string[];
  className?: string;
}

export function ProgressLoader({ label, completedSteps = [], className }: ProgressLoaderProps) {
  return (
    <div data-testid="progress-loader" className={clsx('flex flex-col items-center gap-6', className)}>
      <div className="h-[200px] w-[200px] rounded-[36px] bg-neutral-300 animate-pulse" />
      <p className="text-heading-lg">{label}</p>
      {completedSteps.length > 0 && (
        <div className="flex flex-col gap-2">
          {completedSteps.map((step) => (
            <div key={step} className="flex items-center gap-2 text-body-md text-neutral-600">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
