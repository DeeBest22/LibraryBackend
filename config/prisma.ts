// src/config/prisma.ts
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { queryTimingExtension } from '../telemetry/prisma-timing.ts';

let prisma: ReturnType<typeof createClient> | undefined;

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    log: process.env.DEBUG === 'true' ? ['query', 'error', 'warn'] : ['error'],
  });

  return client.$extends(queryTimingExtension());
}

export function getPrismaClient() {
  if (!prisma) prisma = createClient();
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await (prisma as any).$disconnect?.();
    prisma = undefined;
  }
}

process.on('SIGTERM', async () => { await disconnectPrisma(); });
process.on('SIGINT', async () => { await disconnectPrisma(); });

export const db = getPrismaClient();