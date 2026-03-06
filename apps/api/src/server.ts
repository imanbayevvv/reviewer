import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { authRoutes } from './modules/auth/auth.routes.js';
import { shopsRoutes } from './modules/shops/shops.routes.js';
import { themesRoutes } from './modules/themes/themes.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { reviewerRoutes } from './modules/reviewer/reviewer.routes.js';
import { startAnalysisWorker } from './modules/shops/analysis.worker.js';
import { startReviewWorker } from './modules/reviewer/reviewer.worker.js';

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  const app = Fastify({ logger: true });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    if (error.message?.includes('Unique constraint')) {
      return reply.status(409).send({ error: 'Resource already exists' });
    }
    app.log.error(error);
    return reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal server error',
    });
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Routes
  await app.register(authRoutes);
  await app.register(shopsRoutes);
  await app.register(themesRoutes);
  await app.register(productsRoutes);
  await app.register(mediaRoutes);
  await app.register(reviewerRoutes);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok' }));

  // Workers
  startAnalysisWorker();
  startReviewWorker();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`API server running on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
