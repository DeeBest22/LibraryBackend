// src/services/health.service.ts
import { db as prisma } from "../config/prisma.ts";

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}