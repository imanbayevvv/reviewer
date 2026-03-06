'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Stepper } from '@resale/ui';
import { api } from '@/lib/api-client';
import { useShopWizard } from '@/stores/shop-wizard';
import type { ShopDto } from '@resale/contracts';

export default function CreateShopPage() {
  const router = useRouter();
  const { shopId, brandName, websiteUrl, setBrandInfo, setShopId } = useShopWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (shopId) {
        // Resuming existing shop — skip creation, just start analysis
        await api.post(`/api/shops/${shopId}/analyze`);
        router.push('/shops/create/analyzing');
      } else {
        const shop = await api.post<ShopDto>('/api/shops', {
          name: brandName,
          websiteUrl,
        });
        setShopId(shop.id);
        await api.post(`/api/shops/${shop.id}/analyze`);
        router.push('/shops/create/analyzing');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create shop');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          <svg className="h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Cancel
        </Button>
        <Stepper current={1} total={2} />
        <div className="w-20" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <h1 className="text-heading-lg">Create a ReSale shop of your brand</h1>
        {error && <p className="text-body-sm text-red-500">{error}</p>}
        <form onSubmit={handleSubmit} className="flex w-[328px] flex-col gap-4">
          <Input
            placeholder="Brand name"
            value={brandName}
            onChange={(e) => setBrandInfo(e.target.value, websiteUrl)}
            required
          />
          <Input
            placeholder="Company website"
            type="url"
            value={websiteUrl}
            onChange={(e) => setBrandInfo(brandName, e.target.value)}
            required
          />
          <div className="flex justify-center">
            <Button type="submit" disabled={loading || !brandName || !websiteUrl}>
              {loading ? 'Creating...' : 'Continue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
