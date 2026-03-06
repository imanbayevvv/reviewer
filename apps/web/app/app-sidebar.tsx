'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Sidebar, NavItem, NavGroup } from '@resale/ui';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ShopDto } from '@resale/contracts';

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { data: shopsData } = useQuery({
    queryKey: queryKeys.shops,
    queryFn: () => api.get<{ items: ShopDto[] }>('/api/shops'),
  });

  const shops = shopsData?.items ?? [];

  return (
    <Sidebar>
      <div className="px-4 py-2">
        <span className="text-body-lg font-bold">ReSale</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        <NavItem
          label="Home"
          active={pathname === '/dashboard'}
          onClick={() => router.push('/dashboard')}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M10 2L3 9h2v7h4v-4h2v4h4V9h2L10 2z" />
            </svg>
          }
        />

        <NavGroup
          label="My Shops"
          defaultOpen={true}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M4 3h12l1 4H3l1-4zM3 8v8a1 1 0 001 1h12a1 1 0 001-1V8H3z" />
            </svg>
          }
        >
          {shops.map((shop) => (
            <NavItem
              key={shop.id}
              label={shop.name}
              active={pathname === `/shops/${shop.id}`}
              onClick={() => router.push(`/shops/${shop.id}`)}
              badge={shop.status === 'ACTIVE' ? undefined : shop.status.toLowerCase()}
            />
          ))}
        </NavGroup>

        <NavItem
          label="Settings"
          active={pathname === '/settings'}
          onClick={() => router.push('/settings')}
          icon={
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          }
        />
      </nav>
    </Sidebar>
  );
}
