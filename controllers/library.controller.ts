// src/controllers/library.controller.ts
import { Request, Response } from 'express';
import * as lib from '../services/library.service.ts'; // pending: services/library.py not yet sent
import {
  LOAN_PERIOD_DAYS, FINE_PER_DAY, MAX_ACTIVE_BORROWS,
  ROLE_ADMIN, ROLE_USER, STATUS_ACTIVE, STATUS_PENDING,
} from '../config/constants.js';
export async function getSession(req: Request, res: Response): Promise<void> {
  let member = await lib.resolveMember(req.user!);
  if (!member) member = await lib.bootstrapAdminIfEmpty(req.user!);

  const config = {
    loanPeriodDays: lib.LOAN_PERIOD_DAYS,
    finePerDay: lib.FINE_PER_DAY,
    borrowLimit: lib.MAX_ACTIVE_BORROWS,
  };
  const account = { email: req.user!.email, name: req.user!.name };

  if (!member) {
    res.status(200).json({ authenticated: true, member: null, needsRegistration: true, config, account });
    return;
  }

  const payload: Record<string, unknown> = {
    authenticated: true,
    member: lib.memberToDict(member),
    needsRegistration: false,
    config,
    account,
  };
  payload.activeBorrows = member.status === lib.STATUS_ACTIVE ? await lib.activeBorrowCount(member.id) : 0;
  res.status(200).json(payload);
}

// src/controllers/library.controller.ts — selfRegister function
export async function selfRegister(req: Request, res: Response): Promise<void> {
  const data = req.validated!.body as {
    first_name: string; last_name: string; matric_number: string; department: string; level: string;
  };

  const clientIp = req.ip ?? 'unknown';
  lib.rateLimit(`register:${clientIp}`, 8, 300);

  const existing = await lib.resolveMember(req.user!);
  if (existing) throw new AppError(409, 'ALREADY_REGISTERED', 'A library profile already exists for this account.');
  if (!req.user!.email) throw new AppError(400, 'NO_EMAIL', 'Your sign-in account has no e-mail address.');

  const created = await lib.createMember(
    { auth_user_id: String(req.user!.id), email: req.user!.email, ...data },
    STATUS_PENDING,
    ROLE_USER,
  );
  res.status(200).json({ member: created, message: 'Registration submitted for librarian approval.' });
}

export async function getBooks(req: Request, res: Response): Promise<void> {
  const { search, category, availability, skip, limit } = req.validated!.query as {
    search?: string; category?: string; availability?: string; skip: number; limit: number;
  };

  const member = await lib.resolveMember(req.user!);
  if (!member || member.role !== lib.ROLE_ADMIN) {
    lib.requireActiveMember(member);
  }

  const result = await lib.searchBooks({ search, category, availability, skip, limit });
  (result as Record<string, unknown>).categories = await lib.listCategories();

  if (member) {
    (result as Record<string, unknown>).activeBorrows = await lib.activeBorrowCount(member.id);
    (result as Record<string, unknown>).borrowLimit = lib.MAX_ACTIVE_BORROWS;
    const openTxns = await lib.listTransactions({ memberId: member.id, status: 'ACTIVE' });
    (result as Record<string, unknown>).myOpenBookIds = openTxns.map((t) => t.bookId);
  }

  res.status(200).json(result);
}

export async function adminCreateBook(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  res.status(200).json(await lib.createBook(req.validated!.body));
}

export async function adminUpdateBook(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const bookId = Number(req.params.bookId);
  res.status(200).json(await lib.updateBook(bookId, req.validated!.body));
}

export async function adminDeleteBook(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const bookId = Number(req.params.bookId);
  await lib.deleteBook(bookId);
  res.status(200).json({ deleted: bookId });
}

export async function adminListMembers(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const { status, search } = req.validated!.query as { status?: string; search?: string };
  const items = await lib.listMembers({ status, search });
  res.status(200).json({ items, counts: await lib.statusCounts() });
}

export async function adminCreateMember(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const { role: requestedRole, ...rest } = req.validated!.body as { role?: string; [k: string]: unknown };
  const role = requestedRole === lib.ROLE_ADMIN || requestedRole === lib.ROLE_USER ? requestedRole : lib.ROLE_USER;
  const created = await lib.createMember(rest, { status: lib.STATUS_ACTIVE, role });
  res.status(200).json({ member: created });
}

export async function adminUpdateMember(req: Request, res: Response): Promise<void> {
  const admin = lib.requireAdmin(await lib.resolveMember(req.user!));
  const memberId = Number(req.params.memberId);
  const data = req.validated!.body as Record<string, unknown>;

  if (admin.id === memberId && data.status && data.status !== lib.STATUS_ACTIVE) {
    throw lib.libraryError(400, 'SELF_DEACTIVATION', 'You cannot deactivate your own account.');
  }
  const payload = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null));
  res.status(200).json({ member: await lib.updateMember(memberId, payload) });
}

export async function adminDeleteMember(req: Request, res: Response): Promise<void> {
  const admin = lib.requireAdmin(await lib.resolveMember(req.user!));
  const memberId = Number(req.params.memberId);
  if (admin.id === memberId) {
    throw lib.libraryError(400, 'SELF_DELETION', 'You cannot delete your own account.');
  }
  await lib.deleteMember(memberId);
  res.status(200).json({ deleted: memberId });
}

// src/controllers/library.controller.ts — borrow()
export async function borrow(req: Request, res: Response): Promise<void> {
  const data = req.validated!.body as { book_id: number; member_id?: number | null };
  const requestedMemberId = data.member_id ?? undefined; // normalize null → undefined
  let member = await lib.resolveMember(req.user!);

  if (requestedMemberId !== undefined && (!member || member.role !== ROLE_ADMIN)) {
    throw new AppError(403, 'FORBIDDEN', 'Only a librarian can borrow on behalf of a member.');
  }

  let targetId: number;
  if (requestedMemberId === undefined) {
    member = lib.requireActiveMember(member);
    targetId = member.id;
  } else {
    lib.requireAdmin(member);
    targetId = requestedMemberId;
  }

  res.status(200).json(await lib.borrowBook(data.book_id, targetId));
}

export async function recordReturn(req: Request, res: Response): Promise<void> {
  const data = req.validated!.body as { transaction_id: number };
  const member = await lib.resolveMember(req.user!);
  if (!member) {
    throw lib.libraryError(403, 'NO_PROFILE', 'No library profile is linked to this account.');
  }
  if (member.role !== lib.ROLE_ADMIN) {
    lib.requireActiveMember(member);
    const mine = await lib.listTransactions({ memberId: member.id, status: 'ACTIVE' });
    if (!mine.some((t) => t.id === data.transaction_id)) {
      throw lib.libraryError(403, 'FORBIDDEN', 'You can only return books borrowed on your account.');
    }
  }
  // rule #5: lib.returnBook must wrap its available_copies increment +
  // BorrowTransaction status/return_date update in a single $transaction.
  res.status(200).json(await lib.returnBook(data.transaction_id));
}

export async function myTransactions(req: Request, res: Response): Promise<void> {
  const member = lib.requireActiveMember(await lib.resolveMember(req.user!));
  const items = await lib.listTransactions({ memberId: member.id });
  const active = items.filter((t) => t.returnDate === null);

  res.status(200).json({
    items,
    stats: {
      activeBorrows: active.length,
      borrowLimit: lib.MAX_ACTIVE_BORROWS,
      dueSoon: active.filter((t) => t.daysRemaining !== null && t.daysRemaining >= 0 && t.daysRemaining <= 3).length,
      overdue: active.filter((t) => t.isOverdue).length,
      totalFines: Math.round(items.reduce((sum, t) => sum + t.fineAmount, 0) * 100) / 100,
      totalBorrowed: items.length,
    },
  });
}

export async function adminTransactions(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const { status, search } = req.validated!.query as { status?: string; search?: string };
  res.status(200).json({ items: await lib.listTransactions({ status, search }) });
}

export async function adminReports(req: Request, res: Response): Promise<void> {
  lib.requireAdmin(await lib.resolveMember(req.user!));
  const [summary, members, catalogue, transactions] = await Promise.all([
    lib.reportSummary(),
    lib.listMembers({ limit: 1000 }),
    lib.searchBooks({ limit: 500 }),
    lib.listTransactions({ limit: 1000 }),
  ]);
  res.status(200).json({ summary, members, books: catalogue.items, transactions });
}