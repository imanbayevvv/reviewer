import { clsx } from 'clsx';

interface NavItemProps {
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}

export function NavItem({ icon, label, active, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-4 py-2 text-body-md transition-colors',
        active
          ? 'bg-neutral-700 text-white'
          : 'text-neutral-900 hover:border hover:border-[rgba(0,0,0,0.3)]',
        !active && 'border border-transparent',
      )}
    >
      {icon && <span className="h-5 w-5 flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <span className="rounded-sm bg-neutral-200 px-1 py-0.5 text-caption text-neutral-800">
          {badge}
        </span>
      )}
    </button>
  );
}
