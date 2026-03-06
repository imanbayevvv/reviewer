import { FastifyInstance } from 'fastify';
import { RegisterInput, LoginInput, RefreshInput } from '@resale/contracts';
import { authenticate } from '../../plugins/auth.js';
import * as authService from './auth.service.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (request, reply) => {
    const input = RegisterInput.parse(request.body);
    try {
      const result = await authService.register(input);
      return reply.status(201).send(result);
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = LoginInput.parse(request.body);
    try {
      const result = await authService.login(input);
      return result;
    } catch (e: any) {
      return reply.status(401).send({ error: e.message });
    }
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const { refreshToken } = RefreshInput.parse(request.body);
    try {
      const result = await authService.refresh(refreshToken);
      return result;
    } catch (e: any) {
      return reply.status(401).send({ error: e.message });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const { refreshToken } = RefreshInput.parse(request.body);
    await authService.logout(refreshToken);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => {
    const userId = (request as any).userId;
    return authService.getMe(userId);
  });
}
