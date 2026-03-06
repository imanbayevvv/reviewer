'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, Button } from '@resale/ui';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ShopDto } from '@resale/contracts';

export default function DashboardPage() {
  const router = useRouter();

  const { data: shopsData, isLoading } = useQuery({
    queryKey: queryKeys.shops,
    queryFn: () => api.get<{ items: ShopDto[]; total: number }>('/api/shops'),
  });

  const shops = shopsData?.items ?? [];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-lg text-neutral-600">Loading...</p>
      </div>
    );
  }

  if (shops.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-heading-lg">Create a ReSale shop of your brand</h1>
        <Button onClick={() => router.push('/shops/create')}>
          Get Started
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface p-4">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card variant="white">
          <h3 className="text-body-lg font-semibold mb-2">Orders</h3>
          <p className="text-heading-xl">0</p>
          <p className="text-body-sm text-neutral-500">No orders yet</p>
        </Card>
        <Card variant="white">
          <h3 className="text-body-lg font-semibold mb-2">Revenue</h3>
          <p className="text-heading-xl">$0</p>
          <p className="text-body-sm text-neutral-500">No revenue yet</p>
        </Card>
      </div>

      <Card variant="white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-body-lg font-semibold">My Shops</h3>
          <Button size="sm" onClick={() => router.push('/shops/create')}>
            + New Shop
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {shops.map((shop) => (
            <div
              key={shop.id}
              className="flex items-center justify-between rounded-md border border-[rgba(0,0,0,0.1)] p-3 hover:border-[rgba(0,0,0,0.3)] cursor-pointer transition-colors"
              onClick={() => router.push(`/shops/${shop.id}`)}
            >
              <div>
                <p className="text-body-md">{shop.name}</p>
                <p className="text-body-sm text-neutral-500">{shop.websiteUrl}</p>
              </div>
              <span className="rounded-sm bg-neutral-200 px-2 py-0.5 text-caption">
                {shop.status.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
