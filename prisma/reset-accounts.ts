// prisma/reset-accounts.ts
//
// Wipes every account, login, and borrow record so the system starts fresh —
// specifically so the "first person to ever log in becomes admin" bootstrap
// rule (bootstrapAdminIfEmpty in library.service.ts) fires again cleanly for
// whichever account you sign in with next.
//
// Deliberately leaves the `books` table untouched — your seeded catalogue is
// not affected.
//
// Usage:
//   npx tsx prisma/reset-accounts.ts
//
// You'll be asked to type CONFIRM before anything is deleted.

import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { db as prisma } from '../config/prisma.ts';

async function main() {
  const [memberCount, userCount, txnCount, stateCount, bookCount] = await Promise.all([
    prisma.member.count(),
    prisma.user.count(),
    prisma.borrowTransaction.count(),
    prisma.oidcState.count(),
    prisma.book.count(),
  ]);

  console.log('This will permanently delete:');
  console.log(`  ${memberCount} member account(s)`);
  console.log(`  ${userCount} login/user record(s)`);
  console.log(`  ${txnCount} borrow/return transaction(s)`);
  console.log(`  ${stateCount} in-progress OIDC login attempt(s)`);
  console.log(`\nThe ${bookCount} book(s) in your catalogue will NOT be touched.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type CONFIRM to proceed: ');
  rl.close();

  if (answer.trim() !== 'CONFIRM') {
    console.log('Aborted — nothing was deleted.');
    return;
  }

  // Order matters only for tidiness here (no real FKs enforce it), but delete
  // transactions before members/users just to avoid any orphaned-looking data
  // mid-run if this gets interrupted.
  await prisma.borrowTransaction.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.oidcState.deleteMany({});

  console.log('\nDone. All accounts and borrow history cleared.');
  console.log('The next person to log in (via OIDC or the admin username/password) will automatically become the sole admin.');
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
