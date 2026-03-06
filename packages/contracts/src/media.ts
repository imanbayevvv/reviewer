import { z } from 'zod';

export const MediaAssetDto = z.object({
  id: z.string(),
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: z.string(),
});
export type MediaAssetDto = z.infer<typeof MediaAssetDto>;
