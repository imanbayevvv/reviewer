import { clsx } from 'clsx';

interface Tab {
  label: string;
  value: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={clsx('inline-flex gap-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'rounded-md px-4 py-2 text-body-md transition-colors',
            tab.value === value
              ? 'border-2 border-[rgba(0,0,0,0.3)]'
              : 'border border-transparent hover:border-[rgba(0,0,0,0.3)]',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
