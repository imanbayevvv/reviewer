'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { isSnapshotMode, applySnapshotMode, signalReady, waitForVisualStability } from '@/lib/snapshot-mode';
import { useShopWizard } from '@/stores/shop-wizard';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );

  useEffect(() => {
    if (isSnapshotMode()) {
      applySnapshotMode();

      // Hydrate wizard store from snapshot query params (_shopId, _themeId)
      const params = new URLSearchParams(window.location.search);
      const _shopId = params.get('_shopId');
      const _themeId = params.get('_themeId');
      if (_shopId || _themeId) {
        useShopWizard.getState().hydrateFromSnapshot({
          shopId: _shopId ?? undefined,
          themeId: _themeId ?? undefined,
        });
      }

      // Signal ready after visual stability is achieved
      waitForVisualStability().then(() => signalReady());
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
