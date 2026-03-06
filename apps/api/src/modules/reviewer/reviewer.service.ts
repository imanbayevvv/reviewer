import { prisma } from '../../lib/prisma.js';
import { reviewQueue } from '../../lib/queue.js';
import { logEvent } from '../../lib/event-log.js';
import type { CreateSnapshotInput, CreateReviewJobInput, CreatePatchInput } from '@resale/contracts';

export async function createSnapshot(input: CreateSnapshotInput, actorId: string) {
  const snapshot = await prisma.designSnapshot.create({
    data: {
      shopId: input.shopId,
      source: input.source,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    },
  });
  await logEvent('DesignSnapshot', snapshot.id, 'CREATED', actorId);
  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

export async function getSnapshot(id: string) {
  const snap = await prisma.designSnapshot.findUniqueOrThrow({ where: { id } });
  return { ...snap, createdAt: snap.createdAt.toISOString() };
}

export async function createReviewJob(input: CreateReviewJobInput, actorId: string) {
  const job = await prisma.reviewJob.create({
    data: { snapshotId: input.snapshotId, type: input.type },
  });
  await reviewQueue.add('review', { jobId: job.id });
  await logEvent('ReviewJob', job.id, 'QUEUED', actorId);
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    completedAt: null,
    issues: [],
  };
}

export async function getReviewJob(id: string) {
  const job = await prisma.reviewJob.findUniqueOrThrow({
    where: { id },
    include: { issues: true },
  });
  return {
    ...job,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function listReviewJobs(query: { snapshotId?: string; status?: string; page?: number; limit?: number }) {
  const where: any = {};
  if (query.snapshotId) where.snapshotId = query.snapshotId;
  if (query.status) where.status = query.status;
  const page = query.page || 1;
  const limit = query.limit || 20;

  const [items, total] = await Promise.all([
    prisma.reviewJob.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { issues: true },
    }),
    prisma.reviewJob.count({ where }),
  ]);

  return {
    items: items.map((j) => ({
      ...j,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function createPatch(input: CreatePatchInput, actorId: string) {
  const patch = await prisma.reviewPatch.create({
    data: { issueId: input.issueId, patchType: input.patchType, payload: JSON.parse(JSON.stringify(input.payload)) },
  });
  await logEvent('ReviewPatch', patch.id, 'CREATED', actorId);
  return { ...patch, createdAt: patch.createdAt.toISOString() };
}

export async function updatePatchStatus(id: string, status: string, actorId: string) {
  const patch = await prisma.reviewPatch.update({
    where: { id },
    data: { status: status as any },
  });
  await logEvent('ReviewPatch', id, 'STATUS_CHANGED', actorId, { status });
  return { ...patch, createdAt: patch.createdAt.toISOString() };
}
