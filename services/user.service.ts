// src/services/user.service.ts
import prisma from "../config/prisma";

export async function getUserProfile(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function updateUserProfile(userId: string, name?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && name !== undefined) {
    return prisma.user.update({ where: { id: userId }, data: { name } });
  }
  return user;
}