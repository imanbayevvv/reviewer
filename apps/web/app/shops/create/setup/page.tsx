'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Stepper, FileUploader, Divider } from '@resale/ui';
import { api } from '@/lib/api-client';
import { useShopWizard } from '@/stores/shop-wizard';
import { queryKeys } from '@/lib/query-keys';
import type { MediaAssetDto } from '@resale/contracts';

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    shopId, logoPreview, headlineFont, bodyFont, primaryColor, secondaryColor,
    setLogoFile, setFonts, setColors, reset,
  } = useShopWizard();
  const [loading, setLoading] = useState(false);

  async function handleFinish() {
    if (!shopId) return;
    setLoading(true);
    try {
      const logoFile = useShopWizard.getState().logoFile;
      let logoUrl: string | undefined;

      if (logoFile) {
        const formData = new FormData();
        formData.append('file', logoFile);
        formData.append('entityType', 'shop');
        formData.append('entityId', shopId);
        const asset = await api.post<MediaAssetDto>('/api/media/upload', formData);
        logoUrl = asset.url;
      }

      await api.patch(`/api/shops/${shopId}`, {
        logoUrl,
        headlineFont: headlineFont || undefined,
        bodyFont: bodyFont || undefined,
        primaryColor: primaryColor || undefined,
        secondaryColor: secondaryColor || undefined,
        status: 'ACTIVE',
      });

      await queryClient.invalidateQueries({ queryKey: queryKeys.shops });
      reset();
      router.push('/dashboard');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (!shopId) {
    router.push('/shops/create');
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          Cancel
        </Button>
        <Stepper current={1} total={2} />
        <Button variant="ghost" onClick={() => router.back()}>
          Back
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-4">
        <div className="mx-auto max-w-lg flex flex-col gap-6">
          <div>
            <h3 className="text-body-lg font-semibold mb-3">Logo</h3>
            <FileUploader
              previewUrl={logoPreview}
              onFile={(file) => setLogoFile(file)}
              onRemove={() => setLogoFile(null)}
            />
          </div>

          <Divider />

          <div>
            <h3 className="text-body-lg font-semibold mb-3">Select fonts</h3>
            <div className="flex flex-col gap-3">
              <Input
                label="For headlines and buttons"
                value={headlineFont}
                onChange={(e) => setFonts(e.target.value, bodyFont)}
                placeholder="Google Sans"
              />
              <Input
                label="For other content"
                value={bodyFont}
                onChange={(e) => setFonts(headlineFont, e.target.value)}
                placeholder="Inter"
              />
            </div>
          </div>

          <Divider />

          <div>
            <h3 className="text-body-lg font-semibold mb-3">Colors</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-body-lg text-neutral-600 mb-1.5 block">Primary for accent</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setColors(e.target.value, secondaryColor)}
                    className="h-10 w-10 cursor-pointer rounded border-0"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setColors(e.target.value, secondaryColor)}
                    className="flex-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-body-lg text-neutral-600 mb-1.5 block">Secondary for less</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setColors(primaryColor, e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded border-0"
                  />
                  <Input
                    value={secondaryColor}
                    onChange={(e) => setColors(primaryColor, e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center border-t border-[rgba(0,0,0,0.1)] px-4 py-3">
        <Button onClick={handleFinish} disabled={loading}>
          {loading ? 'Launching...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
