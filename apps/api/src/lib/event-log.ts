import { prisma } from './prisma.js';

export async function logEvent(
  entityType: string,
  entityId: string,
  action: string,
  actorId?: string,
  payload?: Record<string, unknown>,
) {
  await prisma.eventLog.create({
    data: {
      entityType,
      entityId,
      action,
      actorId,
      payload: payload ? JSON.parse(JSON.stringify(payload)) : undefined,
    },
  });
}
