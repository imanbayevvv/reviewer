'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Badge, Tabs } from '@resale/ui';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { ShopDto, ProductDto } from '@resale/contracts';
import { useState, useCallback } from 'react';
import { useShopWizard } from '@/stores/shop-wizard';
import { useQueryClient } from '@tanstack/react-query';

export default function ShopDetailPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const router = useRouter();
  const wizard = useShopWizard();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!confirm('Удалить этот магазин? Это действие нельзя отменить.')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/shops/${shopId}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.shops });
      router.push('/dashboard');
    } catch {
      setDeleting(false);
      alert('Не удалось удалить магазин');
    }
  }, [shopId, queryClient, router]);

  const { data: shop, isLoading } = useQuery({
    queryKey: queryKeys.shop(shopId),
    queryFn: () => api.get<ShopDto>(`/api/shops/${shopId}`),
  });

  const { data: productsData } = useQuery({
    queryKey: queryKeys.products(shopId),
    queryFn: () => api.get<{ items: ProductDto[]; total: number }>(`/api/shops/${shopId}/products`),
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-lg text-neutral-600">Loading...</p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-body-lg text-neutral-600">Shop not found</p>
      </div>
    );
  }

  const products = productsData?.items ?? [];
  const needsSetup = shop.status === 'DRAFT' || shop.status === 'ANALYZING' || shop.status === 'THEME_SELECTION' || shop.status === 'SETUP';

  return (
    <div className="rounded-xl bg-surface p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-lg">{shop.name}</h1>
          <p className="text-body-sm text-neutral-500">{shop.websiteUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-neutral-200 px-2 py-1 text-caption">
            {shop.status.toLowerCase()}
          </span>
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting}>
            <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
            </svg>
          </Button>
        </div>
      </div>

      {needsSetup && (
        <Card variant="white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body-lg font-semibold">Finish setting up your shop</p>
              <p className="text-body-sm text-neutral-500">
                Complete the wizard to launch your resale shop.
              </p>
            </div>
            <Button onClick={() => {
              wizard.setShopId(shop.id);
              wizard.setBrandInfo(shop.name, shop.websiteUrl || '');
              if (shop.themeId) wizard.setThemeId(shop.themeId);
              if (shop.status === 'DRAFT') {
                router.push('/shops/create');
              } else if (shop.status === 'ANALYZING') {
                router.push('/shops/create/analyzing');
              } else if (shop.status === 'THEME_SELECTION') {
                router.push('/shops/create/theme');
              } else {
                router.push('/shops/create/setup');
              }
            }}>
              Continue Setup
            </Button>
          </div>
        </Card>
      )}

      <Tabs
        tabs={[
          { label: 'Overview', value: 'overview' },
          { label: 'Products', value: 'products' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-4">
          <Card variant="white">
            <h3 className="text-body-lg font-semibold mb-2">Theme</h3>
            <p className="text-body-md text-neutral-600">
              {shop.themeId ? 'Selected' : 'Not selected'}
            </p>
          </Card>
          <Card variant="white">
            <h3 className="text-body-lg font-semibold mb-2">Products</h3>
            <p className="text-heading-xl">{productsData?.total ?? 0}</p>
          </Card>
          <Card variant="white">
            <h3 className="text-body-lg font-semibold mb-2">Colors</h3>
            <div className="flex gap-2">
              {shop.primaryColor && (
                <div className="h-8 w-8 rounded-md border" style={{ backgroundColor: shop.primaryColor }} />
              )}
              {shop.secondaryColor && (
                <div className="h-8 w-8 rounded-md border" style={{ backgroundColor: shop.secondaryColor }} />
              )}
              {!shop.primaryColor && !shop.secondaryColor && (
                <p className="text-body-sm text-neutral-500">Not set</p>
              )}
            </div>
          </Card>
          <Card variant="white">
            <h3 className="text-body-lg font-semibold mb-2">Fonts</h3>
            <p className="text-body-md text-neutral-600">
              {shop.headlineFont || shop.bodyFont
                ? `${shop.headlineFont || '—'} / ${shop.bodyFont || '—'}`
                : 'Not set'}
            </p>
          </Card>
        </div>
      )}

      {tab === 'products' && (
        <Card variant="white">
          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-body-lg text-neutral-500">No products yet</p>
              <Button size="sm">+ Add Product</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {products.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border border-[rgba(0,0,0,0.1)] p-3">
                  <div>
                    <p className="text-body-md">{p.title}</p>
                    <p className="text-body-sm text-neutral-500">${p.price.toFixed(2)}</p>
                  </div>
                  <span className="rounded-sm bg-neutral-200 px-2 py-0.5 text-caption">
                    {p.status.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
