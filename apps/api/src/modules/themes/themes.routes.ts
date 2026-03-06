import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

export async function themesRoutes(app: FastifyInstance) {
  app.get('/api/themes', async () => {
    return prisma.theme.findMany({ orderBy: { name: 'asc' } });
  });

  app.get('/api/themes/:id', async (request, reply) => {
    const { id } = request.params as any;
    const theme = await prisma.theme.findUnique({ where: { id } });
    if (!theme) return reply.status(404).send({ error: 'Theme not found' });
    return theme;
  });
}
