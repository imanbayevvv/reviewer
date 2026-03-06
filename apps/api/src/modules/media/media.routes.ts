import { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth.js';
import { prisma } from '../../lib/prisma.js';
import { uploadToS3, generateS3Key, deleteFromS3 } from '../../lib/s3.js';
import { logEvent } from '../../lib/event-log.js';

export async function mediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/api/media/upload', async (request, reply) => {
    const userId = (request as any).userId;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const buffer = await data.toBuffer();
    const entityType = (data.fields.entityType as any)?.value || 'general';
    const entityId = (data.fields.entityId as any)?.value || 'none';

    const s3Key = generateS3Key(entityType, data.filename);
    const url = await uploadToS3(s3Key, buffer, data.mimetype);

    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: userId,
        entityType,
        entityId,
        url,
        s3Key,
        mimeType: data.mimetype,
        sizeBytes: buffer.length,
      },
    });

    await logEvent('MediaAsset', asset.id, 'UPLOADED', userId);

    return reply.status(201).send({
      id: asset.id,
      url: asset.url,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      entityType: asset.entityType,
      entityId: asset.entityId,
      createdAt: asset.createdAt.toISOString(),
    });
  });

  app.get('/api/media/:id', async (request, reply) => {
    const { id } = request.params as any;
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return reply.status(404).send({ error: 'Not found' });
    return {
      id: asset.id,
      url: asset.url,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      entityType: asset.entityType,
      entityId: asset.entityId,
      createdAt: asset.createdAt.toISOString(),
    };
  });

  app.delete('/api/media/:id', async (request, reply) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    const asset = await prisma.mediaAsset.findFirst({ where: { id, ownerId: userId } });
    if (!asset) return reply.status(404).send({ error: 'Not found' });
    await deleteFromS3(asset.s3Key);
    await prisma.mediaAsset.delete({ where: { id } });
    await logEvent('MediaAsset', id, 'DELETED', userId);
    return { ok: true };
  });
}
