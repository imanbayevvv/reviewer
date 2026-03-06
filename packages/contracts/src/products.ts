import { z } from 'zod';
import { ProductStatus } from './enums';

export const CreateProductInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  price: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  sku: z.string().max(100).optional(),
  categoryId: z.string().optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

export const UpdateProductInput = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  price: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  sku: z.string().max(100).optional(),
  categoryId: z.string().nullable().optional(),
  status: ProductStatus.optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

export const ProductDto = z.object({
  id: z.string(),
  shopId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  currency: z.string(),
  sku: z.string().nullable(),
  status: ProductStatus,
  categoryId: z.string().nullable(),
  images: z.array(z.object({ id: z.string(), url: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof ProductDto>;

export const ProductListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: ProductStatus.optional(),
  sort: z.enum(['createdAt', 'price', 'title']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

export const PaginatedResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  });
