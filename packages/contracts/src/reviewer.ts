import { z } from 'zod';
import { ReviewJobStatus, ReviewJobType, IssueSeverity, PatchStatus } from './enums';

export const CreateSnapshotInput = z.object({
  shopId: z.string(),
  source: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateSnapshotInput = z.infer<typeof CreateSnapshotInput>;

export const DesignSnapshotDto = z.object({
  id: z.string(),
  shopId: z.string(),
  source: z.string(),
  version: z.number(),
  metadata: z.record(z.unknown()).nullable(),
  treeUrl: z.string().nullable(),
  screenshotUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type DesignSnapshotDto = z.infer<typeof DesignSnapshotDto>;

export const CreateReviewJobInput = z.object({
  snapshotId: z.string(),
  type: ReviewJobType,
});
export type CreateReviewJobInput = z.infer<typeof CreateReviewJobInput>;

export const ReviewIssueDto = z.object({
  id: z.string(),
  reviewJobId: z.string(),
  severity: IssueSeverity,
  category: z.string(),
  message: z.string(),
  nodeRef: z.string().nullable(),
  suggestion: z.string().nullable(),
});
export type ReviewIssueDto = z.infer<typeof ReviewIssueDto>;

export const ReviewJobDto = z.object({
  id: z.string(),
  snapshotId: z.string(),
  type: ReviewJobType,
  status: ReviewJobStatus,
  score: z.number().nullable(),
  issues: z.array(ReviewIssueDto).optional(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ReviewJobDto = z.infer<typeof ReviewJobDto>;

export const CreatePatchInput = z.object({
  issueId: z.string(),
  patchType: z.string(),
  payload: z.record(z.unknown()),
});
export type CreatePatchInput = z.infer<typeof CreatePatchInput>;

export const ReviewPatchDto = z.object({
  id: z.string(),
  issueId: z.string(),
  patchType: z.string(),
  payload: z.record(z.unknown()),
  status: PatchStatus,
  createdAt: z.string(),
});
export type ReviewPatchDto = z.infer<typeof ReviewPatchDto>;
