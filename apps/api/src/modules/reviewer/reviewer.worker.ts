import { createWorker } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { logEvent } from '../../lib/event-log.js';

interface ReviewPayload {
  jobId: string;
}

export function startReviewWorker() {
  return createWorker<ReviewPayload>('review-jobs', async (job) => {
    const { jobId } = job.data;

    await prisma.reviewJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING' },
    });

    // Stub: simulate AI review with mock issues
    await new Promise((r) => setTimeout(r, 2000));

    const mockIssues = [
      {
        reviewJobId: jobId,
        severity: 'WARNING',
        category: 'accessibility',
        message: 'Low contrast ratio on secondary text',
        nodeRef: null,
        suggestion: 'Increase text color darkness to meet WCAG AA standard',
      },
      {
        reviewJobId: jobId,
        severity: 'INFO',
        category: 'consistency',
        message: 'Button border radius varies between 12px and 16px',
        nodeRef: null,
        suggestion: 'Standardize to 12px as per design system',
      },
      {
        reviewJobId: jobId,
        severity: 'ERROR',
        category: 'spacing',
        message: 'Missing 8px grid alignment on card padding',
        nodeRef: null,
        suggestion: 'Change padding from 20px to 24px',
      },
    ];

    await prisma.reviewIssue.createMany({ data: mockIssues });

    await prisma.reviewJob.update({
      where: { id: jobId },
      data: {
        status: 'DONE',
        score: 72,
        completedAt: new Date(),
        result: { issueCount: mockIssues.length, summary: 'Mock review completed' },
      },
    });

    await logEvent('ReviewJob', jobId, 'COMPLETED');
  });
}
