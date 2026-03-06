import { clsx } from 'clsx';

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'flex h-screen w-sidebar flex-col gap-4 px-2 py-6 flex-shrink-0',
        className,
      )}
    >
      {children}
    </aside>
  );
}
