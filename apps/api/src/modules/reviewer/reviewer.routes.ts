import { FastifyInstance } from 'fastify';
import { CreateSnapshotInput, CreateReviewJobInput, CreatePatchInput, PatchStatus } from '@resale/contracts';
import { authenticate } from '../../plugins/auth.js';
import * as reviewerService from './reviewer.service.js';

export async function reviewerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/api/snapshots', async (request, reply) => {
    const userId = (request as any).userId;
    const input = CreateSnapshotInput.parse(request.body);
    const snapshot = await reviewerService.createSnapshot(input, userId);
    return reply.status(201).send(snapshot);
  });

  app.get('/api/snapshots/:id', async (request) => {
    const { id } = request.params as any;
    return reviewerService.getSnapshot(id);
  });

  app.post('/api/review-jobs', async (request, reply) => {
    const userId = (request as any).userId;
    const input = CreateReviewJobInput.parse(request.body);
    const job = await reviewerService.createReviewJob(input, userId);
    return reply.status(201).send(job);
  });

  app.get('/api/review-jobs/:id', async (request) => {
    const { id } = request.params as any;
    return reviewerService.getReviewJob(id);
  });

  app.get('/api/review-jobs', async (request) => {
    const query = request.query as any;
    return reviewerService.listReviewJobs(query);
  });

  app.post('/api/review-patches', async (request, reply) => {
    const userId = (request as any).userId;
    const input = CreatePatchInput.parse(request.body);
    const patch = await reviewerService.createPatch(input, userId);
    return reply.status(201).send(patch);
  });

  app.patch('/api/review-patches/:id', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    const { status } = request.body as any;
    PatchStatus.parse(status);
    return reviewerService.updatePatchStatus(id, status, userId);
  });
}
