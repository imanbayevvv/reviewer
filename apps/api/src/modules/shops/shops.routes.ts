import { FastifyInstance } from 'fastify';
import { CreateShopInput, UpdateShopInput } from '@resale/contracts';
import { authenticate } from '../../plugins/auth.js';
import * as shopsService from './shops.service.js';

export async function shopsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/api/shops', async (request) => {
    const userId = (request as any).userId;
    const { page, limit } = request.query as any;
    return shopsService.listShops(userId, Number(page) || 1, Number(limit) || 20);
  });

  app.post('/api/shops', async (request, reply) => {
    const userId = (request as any).userId;
    const input = CreateShopInput.parse(request.body);
    const shop = await shopsService.createShop(userId, input);
    return reply.status(201).send(shop);
  });

  app.get('/api/shops/:id', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    return shopsService.getShop(id, userId);
  });

  app.patch('/api/shops/:id', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    const input = UpdateShopInput.parse(request.body);
    return shopsService.updateShop(id, userId, input);
  });

  app.delete('/api/shops/:id', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    await shopsService.deleteShop(id, userId);
    return { ok: true };
  });

  app.post('/api/shops/:id/analyze', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    return shopsService.startAnalysis(id, userId);
  });

  app.get('/api/shops/:id/analysis', async (request) => {
    const userId = (request as any).userId;
    const { id } = request.params as any;
    return shopsService.getAnalysis(id, userId);
  });
}
