import { Queue, Worker, Job } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: REDIS_URL };

export const analysisQueue = new Queue('shop-analysis', { connection });
export const reviewQueue = new Queue('review-jobs', { connection });

export function createWorker<T>(
  queueName: string,
  processor: (job: Job<T>) => Promise<void>,
) {
  return new Worker<T>(queueName, processor, { connection });
}
