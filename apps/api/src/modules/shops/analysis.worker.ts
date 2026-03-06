import { createWorker } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { logEvent } from '../../lib/event-log.js';

interface AnalysisPayload {
  shopId: string;
  websiteUrl: string;
}

const STEPS = ['FONTS', 'COLORS', 'LOGO', 'WEBSITE'] as const;

export function startAnalysisWorker() {
  return createWorker<AnalysisPayload>('shop-analysis', async (job) => {
    const { shopId, websiteUrl } = job.data;

    for (const step of STEPS) {
      await prisma.shopAnalysisStep.update({
        where: { shopId_step: { shopId, step } },
        data: { status: 'RUNNING' },
      });

      // Stub: simulate analysis work
      await new Promise((r) => setTimeout(r, 3000));

      const mockResult: Record<string, unknown> = {};
      switch (step) {
        case 'FONTS':
          mockResult.fonts = ['Google Sans', 'Inter'];
          break;
        case 'COLORS':
          mockResult.colors = ['#000000', '#686868', '#f6f6f6', '#ffffff'];
          break;
        case 'LOGO':
          mockResult.logoDetected = true;
          mockResult.logoUrl = null;
          break;
        case 'WEBSITE':
          mockResult.title = 'Lululemon';
          mockResult.description = 'Athletic apparel';
          break;
      }

      await prisma.shopAnalysisStep.update({
        where: { shopId_step: { shopId, step } },
        data: { status: 'DONE', result: JSON.parse(JSON.stringify(mockResult)) },
      });
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { status: 'THEME_SELECTION' },
    });

    await logEvent('Shop', shopId, 'ANALYSIS_COMPLETED');
  });
}
