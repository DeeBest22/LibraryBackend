// prisma/whoami-admin.ts
//
// Emergency diagnostic: lists every member account in the database, in the
// order they were created, and clearly flags who is (and isn't) an admin.
// Run this any time you're unsure which account controls the system.
//
// Usage:
//   npx tsx prisma/whoami-admin.ts

import 'dotenv/config';
import { db as prisma } from '../config/prisma.ts';

async function main() {
  const members = await prisma.member.findMany({
    orderBy: { created_at: 'asc' },
  });

  if (members.length === 0) {
    console.log('No members exist yet. The next person to log in will automatically become admin.');
    return;
  }

  console.log(`Found ${members.length} member account(s):\n`);

  for (const m of members) {
    const flag = m.role === 'ADMIN' ? '★ ADMIN' : '  member';
    console.log(
      `[${flag}] id=${m.id}  email=${m.email}  name="${m.first_name} ${m.last_name}"  ` +
      `status=${m.status}  auth_user_id=${m.auth_user_id ?? '(not linked yet)'}  created=${m.created_at.toISOString()}`,
    );
  }

  const admins = members.filter((m) => m.role === 'ADMIN');
  console.log(`\n${admins.length} admin account(s) found.`);
  if (admins.length === 0) {
    console.log('⚠️  No admin exists! See prisma/force-promote-admin.ts to fix this.');
  } else if (admins.length > 1) {
    console.log('⚠️  More than one admin exists — worth double-checking that\'s intentional.');
  }
}

main()
  .catch((err) => {
    console.error('Failed to list members:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
