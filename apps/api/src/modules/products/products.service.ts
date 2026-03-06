import { prisma } from '../../lib/prisma.js';
import { logEvent } from '../../lib/event-log.js';
import type { CreateProductInput, UpdateProductInput, ProductListQuery } from '@resale/contracts';

function toDto(product: any) {
  return {
    ...product,
    images: product.images?.map((i: any) => ({ id: i.id, url: i.url })) ?? [],
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export async function listProducts(shopId: string, query: ProductListQuery) {
  const where: any = { shopId };
  if (query.status) where.status = query.status;
  if (query.search) where.title = { contains: query.search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { [query.sort]: query.order },
      include: { images: { select: { id: true, url: true } } },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map(toDto),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function createProduct(shopId: string, ownerId: string, input: CreateProductInput) {
  const product = await prisma.product.create({
    data: { shopId, ...input },
    include: { images: { select: { id: true, url: true } } },
  });
  await logEvent('Product', product.id, 'CREATED', ownerId, { title: product.title });
  return toDto(product);
}

export async function getProduct(shopId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, shopId },
    include: { images: { select: { id: true, url: true } } },
  });
  if (!product) throw new Error('Product not found');
  return toDto(product);
}

export async function updateProduct(shopId: string, productId: string, ownerId: string, input: UpdateProductInput) {
  const product = await prisma.product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new Error('Product not found');
  const updated = await prisma.product.update({
    where: { id: productId },
    data: input,
    include: { images: { select: { id: true, url: true } } },
  });
  await logEvent('Product', productId, 'UPDATED', ownerId);
  return toDto(updated);
}

export async function deleteProduct(shopId: string, productId: string, ownerId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new Error('Product not found');
  await prisma.product.delete({ where: { id: productId } });
  await logEvent('Product', productId, 'DELETED', ownerId);
}
