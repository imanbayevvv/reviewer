'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, Stepper, ThemeCard, Tabs, Divider } from '@resale/ui';
import { api } from '@/lib/api-client';
import { useShopWizard } from '@/stores/shop-wizard';
import { queryKeys } from '@/lib/query-keys';
import type { ThemeDto } from '@resale/contracts';

export default function ThemePage() {
  const router = useRouter();
  const { shopId, themeId, setThemeId } = useShopWizard();
  const [previewMode, setPreviewMode] = useState('desktop');

  const { data: themes } = useQuery({
    queryKey: queryKeys.themes,
    queryFn: () => api.get<ThemeDto[]>('/api/themes'),
  });

  async function handleContinue() {
    if (!shopId || !themeId) return;
    await api.patch(`/api/shops/${shopId}`, { themeId, status: 'SETUP' });
    router.push('/shops/create/setup');
  }

  if (!shopId) {
    router.push('/shops/create');
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" onClick={() => router.back()}>
          <svg className="h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Button>
        <Stepper current={2} total={2} />
        <Button variant="ghost" onClick={() => router.back()}>
          Back
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4">
        <h2 className="text-heading-lg mb-4">Choose a theme</h2>

        <div className="flex flex-col">
          {(themes ?? []).map((theme, i) => (
            <div key={theme.id}>
              {i > 0 && <Divider />}
              <ThemeCard
                name={theme.name}
                previewUrl={previewMode === 'desktop' ? theme.previewDesktop : theme.previewMobile}
                selected={themeId === theme.id}
                onSelect={() => setThemeId(theme.id)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[rgba(0,0,0,0.1)] px-4 py-3">
        <Tabs
          tabs={[
            { label: 'Mobile', value: 'mobile' },
            { label: 'Desktop', value: 'desktop' },
          ]}
          value={previewMode}
          onChange={setPreviewMode}
        />
        {themeId && (
          <Button onClick={handleContinue}>Continue</Button>
        )}
      </div>
    </div>
  );
}
