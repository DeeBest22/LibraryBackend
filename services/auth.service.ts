// src/services/auth.service.ts

import { db as prisma } from "../config/prisma.ts";
import { createAccessToken } from "../config/auth.util"; // still unfinished — see handoff
import { env } from "../config/env";

export async function getOrCreateUser(platformSub: string, email: string, name?: string | null) {
  const existing = await prisma.user.findUnique({ where: { id: platformSub } });
  const lastLogin = new Date();

  if (existing) {
    return prisma.user.update({
      where: { id: platformSub },
      data: { email, name: name ?? null, last_login: lastLogin },
    });
  }
  return prisma.user.create({
    data: { id: platformSub, email, name: name ?? null, last_login: lastLogin, role: "user" },
  });
}

export async function issueAppToken(user: { id: string; email: string; role: string; name?: string | null; last_login?: Date | null }) {
  const expiresMinutes = Number(env.JWT_EXPIRE_MINUTES ?? 60) || 60;
  const expiresAt = new Date(Date.now() + expiresMinutes * 60000);

  const claims: Record<string, any> = { sub: user.id, email: user.email, role: user.role };
  if (user.name) claims.name = user.name;
  if (user.last_login) claims.last_login = user.last_login.toISOString();

  const token = createAccessToken(claims, expiresMinutes);
  return { token, expiresAt, claims };
}

export async function storeOidcState(state: string, nonce: string, codeVerifier: string) {
  await prisma.oidcState.deleteMany({ where: { expires_at: { lt: new Date() } } });
  const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minute expiry
  await prisma.oidcState.create({ data: { state, nonce, code_verifier: codeVerifier, expires_at: expiresAt } });
}

export async function getAndDeleteOidcState(state: string) {
  await prisma.oidcState.deleteMany({ where: { expires_at: { lt: new Date() } } });
  const found = await prisma.oidcState.findUnique({ where: { state } });
  if (!found) return null;
  const data = { nonce: found.nonce, codeVerifier: found.code_verifier };
  await prisma.oidcState.delete({ where: { state } });
  return data;
}

/** Idempotent admin bootstrap — call once at server startup. */
export async function initializeAdminUser() {
  if (process.env.MGX_IGNORE_INIT_ADMIN) return;

  const adminUserId = env.ADMIN_USER_ID ?? "";
  const adminUserEmail = env.ADMIN_USER_EMAIL ?? "";
  if (!adminUserId || !adminUserEmail) return;

  const user = await prisma.user.findUnique({ where: { id: adminUserId } });
  if (user) {
    if (user.role !== "admin") {
      await prisma.user.update({ where: { id: adminUserId }, data: { role: "admin", email: adminUserEmail } });
    }
  } else {
    await prisma.user.create({ data: { id: adminUserId, email: adminUserEmail, role: "admin" } });
  }
}