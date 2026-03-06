'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Stepper, ProgressLoader } from '@resale/ui';
import { api } from '@/lib/api-client';
import { useShopWizard } from '@/stores/shop-wizard';
import { queryKeys } from '@/lib/query-keys';
import { isSnapshotMode } from '@/lib/snapshot-mode';
import type { ShopAnalysisDto } from '@resale/contracts';

const STEP_LABELS: Record<string, string> = {
  FONTS: 'Detecting fonts',
  COLORS: 'Extracting colors',
  LOGO: 'Finding logo',
  WEBSITE: 'Analyzing your website',
};

const STEP_DONE_LABELS: Record<string, string> = {
  FONTS: 'Detected fonts',
  COLORS: 'Extracted colors',
  LOGO: 'Found logo',
  WEBSITE: 'Analyzed website',
};

export default function AnalyzingPage() {
  const router = useRouter();
  const { shopId } = useShopWizard();
  const snapshot = isSnapshotMode();

  const { data: analysis } = useQuery({
    queryKey: queryKeys.shopAnalysis(shopId || ''),
    queryFn: () => api.get<ShopAnalysisDto>(`/api/shops/${shopId}/analysis`),
    enabled: !!shopId,
    // In snapshot mode: fetch once, no polling
    refetchInterval: snapshot ? false : 2000,
  });

  const steps = analysis?.steps ?? [];
  const currentStep = steps.find((s) => s.status === 'RUNNING') || steps.find((s) => s.status === 'PENDING');
  const completedSteps = steps.filter((s) => s.status === 'DONE');
  const allDone = steps.length > 0 && steps.every((s) => s.status === 'DONE');

  useEffect(() => {
    // In snapshot mode: never auto-redirect
    if (snapshot) return;
    if (allDone) {
      const timer = setTimeout(() => router.push('/shops/create/theme'), 1000);
      return () => clearTimeout(timer);
    }
  }, [allDone, router, snapshot]);

  if (!shopId) {
    router.push('/shops/create');
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center px-4 py-3">
        <Stepper current={1} total={2} />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <ProgressLoader
          label={currentStep ? STEP_LABELS[currentStep.step] || currentStep.step : 'Completing...'}
          completedSteps={completedSteps.map((s) => STEP_DONE_LABELS[s.step] || s.step)}
        />
      </div>
    </div>
  );
}
