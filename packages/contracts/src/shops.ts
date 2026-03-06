import { z } from 'zod';
import { ShopStatus, AnalysisStep, AnalysisStepStatus } from './enums';

export const CreateShopInput = z.object({
  name: z.string().min(1).max(200),
  websiteUrl: z.string().url(),
});
export type CreateShopInput = z.infer<typeof CreateShopInput>;

export const UpdateShopInput = z.object({
  name: z.string().min(1).max(200).optional(),
  themeId: z.string().optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  headlineFont: z.string().optional(),
  bodyFont: z.string().optional(),
  status: ShopStatus.optional(),
});
export type UpdateShopInput = z.infer<typeof UpdateShopInput>;

export const ShopDto = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  slug: z.string(),
  websiteUrl: z.string(),
  themeId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  headlineFont: z.string().nullable(),
  bodyFont: z.string().nullable(),
  status: ShopStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShopDto = z.infer<typeof ShopDto>;

export const AnalysisStepDto = z.object({
  step: AnalysisStep,
  status: AnalysisStepStatus,
  result: z.record(z.unknown()).nullable(),
});
export type AnalysisStepDto = z.infer<typeof AnalysisStepDto>;

export const ShopAnalysisDto = z.object({
  shopId: z.string(),
  steps: z.array(AnalysisStepDto),
});
export type ShopAnalysisDto = z.infer<typeof ShopAnalysisDto>;

export const ThemeDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  previewDesktop: z.string().nullable(),
  previewMobile: z.string().nullable(),
});
export type ThemeDto = z.infer<typeof ThemeDto>;
