import { z } from 'zod';

export const UserRole = z.enum(['ADMIN', 'SELLER']);
export type UserRole = z.infer<typeof UserRole>;

export const ShopStatus = z.enum([
  'DRAFT',
  'ANALYZING',
  'THEME_SELECTION',
  'SETUP',
  'ACTIVE',
  'PAUSED',
]);
export type ShopStatus = z.infer<typeof ShopStatus>;

export const AnalysisStep = z.enum(['FONTS', 'COLORS', 'LOGO', 'WEBSITE']);
export type AnalysisStep = z.infer<typeof AnalysisStep>;

export const AnalysisStepStatus = z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']);
export type AnalysisStepStatus = z.infer<typeof AnalysisStepStatus>;

export const ProductStatus = z.enum(['DRAFT', 'PUBLISHED', 'SOLD', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof ProductStatus>;

export const ReviewJobStatus = z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']);
export type ReviewJobStatus = z.infer<typeof ReviewJobStatus>;

export const ReviewJobType = z.enum(['SCREEN', 'FLOW', 'COMPONENT']);
export type ReviewJobType = z.infer<typeof ReviewJobType>;

export const IssueSeverity = z.enum(['INFO', 'WARNING', 'ERROR']);
export type IssueSeverity = z.infer<typeof IssueSeverity>;

export const PatchStatus = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']);
export type PatchStatus = z.infer<typeof PatchStatus>;
