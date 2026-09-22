// prisma/force-promote-admin.ts
//
// Emergency recovery: guarantees the given email is an ACTIVE admin member,
// regardless of the current state of the database. Use this if you're ever
// unsure who the admin is, or if you've lost access.
//
// - If a member with this email already exists, it is promoted to
//   role=ADMIN and status=ACTIVE (whatever it was before).
// - If no such member exists yet, one is created directly with
//   role=ADMIN and status=ACTIVE. It will auto-link the first time
//   someone logs in with that same email (via OIDC) or you can link it
//   to the local admin-login account (see note below).
//
// Usage:
//   npx tsx prisma/force-promote-admin.ts you@example.com "Your Name"

import 'dotenv/config';
import { db as prisma } from '../config/prisma.ts';

async function main() {
  const email = process.argv[2];
  const name = process.argv[3] ?? 'Administrator';

  if (!email) {
    console.error('Usage: npx tsx prisma/force-promote-admin.ts <email> ["Full Name"]');
    process.exit(1);
  }

  const [first, ...rest] = name.trim().split(' ');
  const last = rest.join(' ') || first;

  const existing = await prisma.member.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  if (existing) {
    const updated = await prisma.member.update({
      where: { id: existing.id },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    console.log(`Promoted existing member #${updated.id} (${updated.email}) to ACTIVE admin.`);
  } else {
    const created = await prisma.member.create({
      data: {
        email,
        first_name: first,
        last_name: last,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log(
      `Created a new ACTIVE admin member #${created.id} (${created.email}).\n` +
      `It has no auth_user_id yet — it will link automatically the first time ` +
      `someone logs in (via the university OIDC flow) using this exact email address.`,
    );
  }
}

main()
  .catch((err) => {
    console.error('Failed to promote admin:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
