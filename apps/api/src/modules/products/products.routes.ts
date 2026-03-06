import { FastifyInstance } from 'fastify';
import { CreateProductInput, UpdateProductInput, ProductListQuery } from '@resale/contracts';
import { authenticate } from '../../plugins/auth.js';
import * as productsService from './products.service.js';

export async function productsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/api/shops/:shopId/products', async (request) => {
    const { shopId } = request.params as any;
    const query = ProductListQuery.parse(request.query);
    return productsService.listProducts(shopId, query);
  });

  app.post('/api/shops/:shopId/products', async (request, reply) => {
    const userId = (request as any).userId;
    const { shopId } = request.params as any;
    const input = CreateProductInput.parse(request.body);
    const product = await productsService.createProduct(shopId, userId, input);
    return reply.status(201).send(product);
  });

  app.get('/api/shops/:shopId/products/:id', async (request) => {
    const { shopId, id } = request.params as any;
    return productsService.getProduct(shopId, id);
  });

  app.patch('/api/shops/:shopId/products/:id', async (request) => {
    const userId = (request as any).userId;
    const { shopId, id } = request.params as any;
    const input = UpdateProductInput.parse(request.body);
    return productsService.updateProduct(shopId, id, userId, input);
  });

  app.delete('/api/shops/:shopId/products/:id', async (request) => {
    const userId = (request as any).userId;
    const { shopId, id } = request.params as any;
    await productsService.deleteProduct(shopId, id, userId);
    return { ok: true };
  });
}
