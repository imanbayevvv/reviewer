import { prisma } from '../../lib/prisma.js';
import { analysisQueue } from '../../lib/queue.js';
import { logEvent } from '../../lib/event-log.js';
import type { CreateShopInput, UpdateShopInput } from '@resale/contracts';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function toDto(shop: any) {
  return {
    ...shop,
    createdAt: shop.createdAt.toISOString(),
    updatedAt: shop.updatedAt.toISOString(),
  };
}

export async function listShops(ownerId: string, page = 1, limit = 20) {
  const [items, total] = await Promise.all([
    prisma.shop.findMany({
      where: { ownerId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.shop.count({ where: { ownerId } }),
  ]);
  return { items: items.map(toDto), total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function createShop(ownerId: string, input: CreateShopInput) {
  const slug = slugify(input.name) + '-' + Date.now().toString(36);
  const shop = await prisma.shop.create({
    data: { ownerId, name: input.name, websiteUrl: input.websiteUrl, slug },
  });
  await logEvent('Shop', shop.id, 'CREATED', ownerId, { name: shop.name });
  return toDto(shop);
}

export async function getShop(id: string, ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { id, ownerId } });
  if (!shop) throw new Error('Shop not found');
  return toDto(shop);
}

export async function updateShop(id: string, ownerId: string, input: UpdateShopInput) {
  const shop = await prisma.shop.findFirst({ where: { id, ownerId } });
  if (!shop) throw new Error('Shop not found');
  const updated = await prisma.shop.update({ where: { id }, data: input });
  await logEvent('Shop', id, 'UPDATED', ownerId, input as Record<string, unknown>);
  return toDto(updated);
}

export async function deleteShop(id: string, ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { id, ownerId } });
  if (!shop) throw new Error('Shop not found');
  await prisma.shop.delete({ where: { id } });
  await logEvent('Shop', id, 'DELETED', ownerId);
}

export async function startAnalysis(shopId: string, ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, ownerId } });
  if (!shop) throw new Error('Shop not found');

  await prisma.shop.update({ where: { id: shopId }, data: { status: 'ANALYZING' } });

  const steps = ['FONTS', 'COLORS', 'LOGO', 'WEBSITE'];
  for (const step of steps) {
    await prisma.shopAnalysisStep.upsert({
      where: { shopId_step: { shopId, step } },
      create: { shopId, step, status: 'PENDING' },
      update: { status: 'PENDING', result: undefined },
    });
  }

  await analysisQueue.add('analyze', { shopId, websiteUrl: shop.websiteUrl });
  await logEvent('Shop', shopId, 'ANALYSIS_STARTED', ownerId);

  return { shopId };
}

export async function getAnalysis(shopId: string, ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, ownerId } });
  if (!shop) throw new Error('Shop not found');

  const steps = await prisma.shopAnalysisStep.findMany({
    where: { shopId },
    orderBy: { createdAt: 'asc' },
  });

  return {
    shopId,
    steps: steps.map((s) => ({ step: s.step, status: s.status, result: s.result })),
  };
}
