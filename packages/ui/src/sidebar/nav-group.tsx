import { useState } from 'react';
import { clsx } from 'clsx';

interface NavGroupProps {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function NavGroup({ icon, label, children, defaultOpen = false }: NavGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-4 py-2 text-body-md text-neutral-900 border border-transparent hover:border-[rgba(0,0,0,0.3)] transition-colors"
      >
        {icon && <span className="h-5 w-5 flex-shrink-0">{icon}</span>}
        <span className="flex-1 text-left">{label}</span>
        <svg
          className={clsx('h-4 w-4 transition-transform', open && 'rotate-90')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      {open && <div className="ml-4 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}
