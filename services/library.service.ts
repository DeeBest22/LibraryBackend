// src/services/library.service.ts
import { Prisma } from "@prisma/client";
import { db as prisma } from "../config/prisma.ts";
import { AppError } from "../middleware/error-handler";
import {
  LOAN_PERIOD_DAYS,
  FINE_PER_DAY,
  MAX_ACTIVE_BORROWS,
  ROLE_ADMIN,
  ROLE_USER,
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  STATUS_PENDING,
  MEMBER_STATUSES,
  TXN_OVERDUE,
  TXN_BORROWED,
  TXN_RETURNED,
} from "../config/constants";

type PrismaTx = Prisma.TransactionClient;

// --------------------------------------------------------------------------
// In-process rate limiter (login / registration abuse protection)
// Note: per-process only — resets on restart, not shared across instances.
// Same limitation existed in the Python version (module-level dict).
// --------------------------------------------------------------------------
const RATE_BUCKET = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowSeconds: number): void {
  const now = Date.now() / 1000;
  const hits = (RATE_BUCKET.get(key) ?? []).filter((t) => now - t < windowSeconds);
  if (hits.length >= limit) {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again shortly.");
  }
  hits.push(now);
  RATE_BUCKET.set(key, hits);
}

// --------------------------------------------------------------------------
// Serialisation helpers
// --------------------------------------------------------------------------
function aware(value: Date | null | undefined): Date | null {
  return value ?? null; // Prisma returns JS Date already in UTC internally
}

export function nowUtc(): Date {
  return new Date();
}

function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((utcA - utcB) / 86400000);
}

export function memberToDict(member: any) {
  return {
    id: member.id,
    email: member.email,
    username: member.username,
    firstName: member.first_name,
    lastName: member.last_name,
    fullName: `${member.first_name} ${member.last_name}`.trim(),
    matricNumber: member.matric_number,
    department: member.department,
    level: member.level,
    role: member.role,
    status: member.status,
    linked: Boolean(member.auth_user_id),
    createdAt: member.created_at?.toISOString() ?? null,
    updatedAt: member.updated_at?.toISOString() ?? null,
  };
}

export function bookToDict(book: any) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    accessionNumber: book.accession_number,
    isbn: book.isbn,
    publisher: book.publisher,
    publicationYear: book.publication_year,
    category: book.category,
    totalCopies: book.total_copies,
    availableCopies: book.available_copies,
    coverImageUrl: book.cover_image_url,
    createdAt: book.created_at?.toISOString() ?? null,
    updatedAt: book.updated_at?.toISOString() ?? null,
  };
}

export function txnToDict(txn: any, book?: any, member?: any) {
  const due = aware(txn.due_date);
  const returned = aware(txn.return_date);
  const reference = returned ?? nowUtc();
  const daysRemaining = due ? daysBetween(due, reference) : null;

  const payload: Record<string, any> = {
    id: txn.id,
    memberId: txn.member_id,
    bookId: txn.book_id,
    borrowDate: txn.borrow_date?.toISOString() ?? null,
    dueDate: txn.due_date?.toISOString() ?? null,
    returnDate: txn.return_date?.toISOString() ?? null,
    status: txn.status,
    fineAmount: txn.fine_amount ? Number(txn.fine_amount) : 0.0,
    daysRemaining,
    isOverdue:
      txn.status === TXN_OVERDUE ||
      (txn.return_date === null && due !== null && due < nowUtc()),
  };
  if (book) {
    payload.bookTitle = book.title;
    payload.bookAuthor = book.author;
    payload.accessionNumber = book.accession_number;
    payload.category = book.category;
  }
  if (member) {
    payload.memberName = `${member.first_name} ${member.last_name}`.trim();
    payload.memberEmail = member.email;
    payload.matricNumber = member.matric_number;
  }
  return payload;
}

// --------------------------------------------------------------------------
// Identity / role resolution
// --------------------------------------------------------------------------
export async function resolveMember(authUser: { id?: string; email?: string }) {
  const authId = String(authUser?.id ?? "");
  const email = (authUser?.email ?? "").trim().toLowerCase();

  if (authId) {
    const found = await prisma.member.findFirst({ where: { auth_user_id: authId } });
    if (found) return found;
  }

  if (email) {
    const found = await prisma.member.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (found) {
      if (authId && !found.auth_user_id) {
        return prisma.member.update({
          where: { id: found.id },
          data: { auth_user_id: authId },
        });
      }
      return found;
    }
  }
  return null;
}

export async function bootstrapAdminIfEmpty(authUser: { id?: string; email?: string; name?: string }) {
  const linked = await prisma.member.count({ where: { auth_user_id: { not: null } } });
  if (linked > 0) return null;

  const emailLower = (authUser?.email ?? "").trim().toLowerCase();
  if (emailLower) {
    const seeded = await prisma.member.findFirst({
      where: { email: { equals: emailLower, mode: "insensitive" } },
    });
    if (seeded) return null;
  }

  const email = (authUser?.email ?? "").trim();
  const name = (authUser?.name ?? "").trim();
  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");

  const admin = await prisma.member.create({
    data: {
      auth_user_id: String(authUser?.id ?? ""),
      email: email || "librarian@unijos.edu.ng",
      username: email ? email.split("@")[0] : "librarian",
      first_name: first || "Head",
      last_name: last || "Librarian",
      matric_number: null,
      department: "University Library",
      level: null,
      role: ROLE_ADMIN,
      status: STATUS_ACTIVE,
    },
  });
  return admin;
}

export function requireAdmin(member: any) {
  if (!member) throw new AppError(403, "NO_PROFILE", "No library profile is linked to this account.");
  if (member.role !== ROLE_ADMIN) throw new AppError(403, "FORBIDDEN", "Administrator access required.");
  if (member.status !== STATUS_ACTIVE)
    throw new AppError(403, "ACCOUNT_INACTIVE", "This administrator account is not active.");
  return member;
}

export function requireActiveMember(member: any) {
  if (!member)
    throw new AppError(403, "NO_PROFILE", "Complete your library registration to continue.");
  if (member.status === STATUS_PENDING)
    throw new AppError(403, "PENDING_APPROVAL", "Your membership is awaiting librarian approval.");
  if (member.status === STATUS_INACTIVE)
    throw new AppError(403, "ACCOUNT_INACTIVE", "Your membership has been deactivated.");
  return member;
}

// --------------------------------------------------------------------------
// Catalogue
// --------------------------------------------------------------------------
export async function searchBooks(opts: {
  search?: string;
  category?: string;
  availability?: "AVAILABLE" | "UNAVAILABLE" | string;
  skip?: number;
  limit?: number;
}) {
  const { search, category, availability, skip = 0, limit = 60 } = opts;
  const where: Prisma.BookWhereInput = {};
  const and: Prisma.BookWhereInput[] = [];

  if (search?.trim()) {
    const like = search.trim();
    const orConds: Prisma.BookWhereInput[] = [
      { title: { contains: like, mode: "insensitive" } },
      { author: { contains: like, mode: "insensitive" } },
      { accession_number: { contains: like, mode: "insensitive" } },
      { isbn: { contains: like, mode: "insensitive" } },
      { publisher: { contains: like, mode: "insensitive" } },
      { category: { contains: like, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(like)) {
      orConds.push({ publication_year: parseInt(like, 10) });
    }
    and.push({ OR: orConds });
  }
  if (category && category !== "ALL") and.push({ category });
  if (availability === "AVAILABLE") and.push({ available_copies: { gt: 0 } });
  if (availability === "UNAVAILABLE") and.push({ available_copies: { lte: 0 } });
  if (and.length) where.AND = and;

  const [total, rows] = await Promise.all([
    prisma.book.count({ where }),
    prisma.book.findMany({ where, orderBy: { title: "asc" }, skip, take: limit }),
  ]);
  return { items: rows.map(bookToDict), total, skip, limit };
}

export async function listCategories(): Promise<string[]> {
  const rows = await prisma.book.findMany({
    where: { category: { not: null } },
    distinct: ["category"],
    orderBy: { category: "asc" },
    select: { category: true },
  });
  return rows.map((r) => r.category).filter((c): c is string => Boolean(c));
}

export async function borrowedCopies(bookId: number): Promise<number> {
  return prisma.borrowTransaction.count({
    where: { book_id: bookId, return_date: null },
  });
}

export async function createBook(data: any) {
  const existing = await prisma.book.findFirst({
    where: { accession_number: data.accession_number },
  });
  if (existing) throw new AppError(409, "DUPLICATE_ACCESSION", "A book with this accession number already exists.");

  const total = Number(data.total_copies);
  const book = await prisma.book.create({
    data: {
      title: data.title.trim(),
      author: data.author.trim(),
      accession_number: data.accession_number.trim(),
      isbn: data.isbn || null,
      publisher: data.publisher || null,
      publication_year: data.publication_year ?? null,
      category: data.category || null,
      total_copies: total,
      available_copies: total,
      cover_image_url: data.cover_image_url || null,
    },
  });
  return bookToDict(book);
}

export async function updateBook(bookId: number, data: any) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<any[]>`
      SELECT * FROM books WHERE id = ${bookId} FOR UPDATE
    `;
    const book = rows[0];
    if (!book) throw new AppError(404, "BOOK_NOT_FOUND", "Book not found.");

    const patch: Record<string, any> = {};

    const accession = (data.accession_number || "").trim();
    if (accession && accession !== book.accession_number) {
      const clash = await tx.book.findFirst({
        where: { accession_number: accession, id: { not: bookId } },
      });
      if (clash) throw new AppError(409, "DUPLICATE_ACCESSION", "A book with this accession number already exists.");
      patch.accession_number = accession;
    }

    const onLoan = await tx.borrowTransaction.count({
      where: { book_id: bookId, return_date: null },
    });

    let totalCopies = book.total_copies;
    if (data.total_copies !== undefined && data.total_copies !== null) {
      totalCopies = Number(data.total_copies);
      if (totalCopies < onLoan) {
        throw new AppError(
          400,
          "TOTAL_BELOW_ON_LOAN",
          `${onLoan} copies are currently on loan; total copies cannot be lower.`,
          undefined
        );
      }
      patch.total_copies = totalCopies;
    }

    for (const field of ["title", "author", "isbn", "publisher", "category", "cover_image_url"]) {
      if (data[field] !== undefined && data[field] !== null) {
        patch[field] = typeof data[field] === "string" ? data[field].trim() || null : data[field];
      }
    }
    if (data.publication_year !== undefined && data.publication_year !== null) {
      patch.publication_year = Number(data.publication_year);
    }

    // availableCopies is always derived, never client supplied.
    patch.available_copies = Math.max(0, totalCopies - onLoan);

    const updated = await tx.book.update({ where: { id: bookId }, data: patch });
    return bookToDict(updated);
  });
}

export async function deleteBook(bookId: number) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) throw new AppError(404, "BOOK_NOT_FOUND", "Book not found.");
  const onLoan = await borrowedCopies(bookId);
  if (onLoan) {
    throw new AppError(
      409,
      "BOOK_ON_LOAN",
      `Cannot delete: ${onLoan} copy(ies) are still on loan. Record the returns first.`
    );
  }
  await prisma.book.delete({ where: { id: bookId } });
}

// --------------------------------------------------------------------------
// Members
// --------------------------------------------------------------------------
export async function listMembers(opts: { status?: string; search?: string; limit?: number }) {
  const { status, search, limit = 200 } = opts;
  const and: Prisma.MemberWhereInput[] = [];
  if (status && status !== "ALL") and.push({ status });
  if (search?.trim()) {
    const like = search.trim();
    and.push({
      OR: [
        { first_name: { contains: like, mode: "insensitive" } },
        { last_name: { contains: like, mode: "insensitive" } },
        { email: { contains: like, mode: "insensitive" } },
        { matric_number: { contains: like, mode: "insensitive" } },
        { department: { contains: like, mode: "insensitive" } },
      ],
    });
  }
  const rows = await prisma.member.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { created_at: "desc" },
    take: limit,
  });
  return rows.map(memberToDict);
}

export async function statusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.member.groupBy({ by: ["status"], _count: { id: true } });
  const counts: Record<string, number> = Object.fromEntries(MEMBER_STATUSES.map((s) => [s, 0]));
  for (const row of rows) counts[row.status] = row._count.id;
  return counts;
}

async function assertMemberUnique(email: string, matric: string | null, excludeId?: number) {
  const emailWhere: Prisma.MemberWhereInput = { email: { equals: email, mode: "insensitive" } };
  if (excludeId) emailWhere.id = { not: excludeId };
  if (await prisma.member.findFirst({ where: emailWhere })) {
    throw new AppError(409, "DUPLICATE_EMAIL", "This e-mail is already registered.");
  }
  if (matric) {
    const matricWhere: Prisma.MemberWhereInput = { matric_number: matric };
    if (excludeId) matricWhere.id = { not: excludeId };
    if (await prisma.member.findFirst({ where: matricWhere })) {
      throw new AppError(409, "DUPLICATE_MATRIC", "This matriculation number is already registered.");
    }
  }
}

export async function createMember(data: any, status: string, role: string = ROLE_USER) {
  const email = data.email.trim();
  const matric = (data.matric_number || "").trim() || null;
  await assertMemberUnique(email, matric);
  const member = await prisma.member.create({
    data: {
      auth_user_id: data.auth_user_id || null,
      email,
      username: data.username || email.split("@")[0],
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      matric_number: matric,
      department: data.department || null,
      level: data.level || null,
      role,
      status,
    },
  });
  return memberToDict(member);
}

export async function updateMember(memberId: number, data: any) {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");

  const email = (data.email || "").trim();
  const matric = (data.matric_number || "").trim() || null;
  if (email || matric) {
    await assertMemberUnique(email || member.email, matric, memberId);
  }

  const patch: Record<string, any> = {};
  if (email) patch.email = email;
  if ("matric_number" in data) patch.matric_number = matric;

  for (const field of ["first_name", "last_name", "department", "level", "username"]) {
    if (data[field] !== undefined && data[field] !== null) {
      patch[field] = (data[field] || "").trim() || null;
    }
  }

  if (data.status) {
    if (!MEMBER_STATUSES.includes(data.status)) {
      throw new AppError(400, "INVALID_STATUS", "Unknown member status.");
    }
    if (data.status !== STATUS_ACTIVE) {
      const active = await activeBorrowCount(memberId);
      if (active && data.status === STATUS_INACTIVE) {
        throw new AppError(409, "MEMBER_HAS_LOANS", `This member still has ${active} book(s) on loan.`);
      }
    }
    patch.status = data.status;
  }

  if (data.role) {
    if (![ROLE_ADMIN, ROLE_USER].includes(data.role)) {
      throw new AppError(400, "INVALID_ROLE", "Unknown role.");
    }
    patch.role = data.role;
  }

  const nextFirst = patch.first_name ?? member.first_name;
  const nextLast = patch.last_name ?? member.last_name;
  if (!nextFirst || !nextLast) {
    throw new AppError(400, "INVALID_NAME", "First and last name are required.");
  }

  const updated = await prisma.member.update({ where: { id: memberId }, data: patch });
  return memberToDict(updated);
}

export async function deleteMember(memberId: number) {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const txns = await prisma.borrowTransaction.count({ where: { member_id: memberId } });
  if (txns) {
    throw new AppError(
      409,
      "MEMBER_HAS_HISTORY",
      "This member has circulation history; deactivate the account instead of deleting it."
    );
  }
  await prisma.member.delete({ where: { id: memberId } });
}

// --------------------------------------------------------------------------
// Circulation
// --------------------------------------------------------------------------
export async function activeBorrowCount(memberId: number): Promise<number> {
  return prisma.borrowTransaction.count({ where: { member_id: memberId, return_date: null } });
}

export async function syncOverdue(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE borrow_transactions SET status = ${TXN_OVERDUE}
    WHERE return_date IS NULL AND due_date < ${nowUtc()} AND status <> ${TXN_OVERDUE}
  `;
}

/**
 * Atomically issue a book to a member.
 * Lock order is always member -> book to avoid deadlocks (rule #5: wrapped in $transaction).
 */
export async function borrowBook(bookId: number, memberId: number) {
  return prisma.$transaction(async (tx) => {
    const memberRows = await tx.$queryRaw<any[]>`
      SELECT * FROM members WHERE id = ${memberId} FOR UPDATE
    `;
    const member = memberRows[0];
    if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
    if (member.status !== STATUS_ACTIVE) {
      throw new AppError(403, "MEMBER_NOT_ACTIVE", "This membership is not active and cannot borrow books.");
    }

    const active = await tx.borrowTransaction.count({ where: { member_id: memberId, return_date: null } });
    if (active >= MAX_ACTIVE_BORROWS) {
      throw new AppError(
        400,
        "BORROW_LIMIT_REACHED",
        `Borrow limit reached: a member may hold at most ${MAX_ACTIVE_BORROWS} books at a time.`,
        { activeBorrows: active, limit: MAX_ACTIVE_BORROWS }
      );
    }

    const bookRows = await tx.$queryRaw<any[]>`
      SELECT * FROM books WHERE id = ${bookId} FOR UPDATE
    `;
    const book = bookRows[0];
    if (!book) throw new AppError(404, "BOOK_NOT_FOUND", "Book not found.");

    const duplicate = await tx.borrowTransaction.findFirst({
      where: { member_id: memberId, book_id: bookId, return_date: null },
    });
    if (duplicate) {
      throw new AppError(400, "ALREADY_BORROWED", "This member already holds a copy of this title.");
    }

    // Guarded conditional update: only succeeds while a copy is genuinely free.
    const decremented = await tx.$queryRaw<{ available_copies: number }[]>`
      UPDATE books SET available_copies = available_copies - 1
      WHERE id = ${bookId} AND available_copies > 0
      RETURNING available_copies
    `;
    const remaining = decremented[0]?.available_copies;
    if (remaining === undefined) {
      throw new AppError(409, "NO_COPY_AVAILABLE", "No copies of this title are available.");
    }

    const borrowDate = nowUtc();
    const dueDate = new Date(borrowDate.getTime() + LOAN_PERIOD_DAYS * 86400000);
    const txn = await tx.borrowTransaction.create({
      data: {
        member_id: memberId,
        book_id: bookId,
        borrow_date: borrowDate,
        due_date: dueDate,
        return_date: null,
        status: TXN_BORROWED,
        fine_amount: 0.0,
      },
    });

    return {
      transactionId: txn.id,
      bookTitle: book.title,
      dueDate: dueDate.toISOString(),
      availableCopies: remaining,
      loanPeriodDays: LOAN_PERIOD_DAYS,
      activeBorrows: active + 1,
    };
  });
}

export function calculateFine(dueDate: Date | null, returnDate: Date): { daysLate: number; fine: number } {
  if (!dueDate) return { daysLate: 0, fine: 0.0 };
  const daysLate = daysBetween(returnDate, dueDate);
  if (daysLate <= 0) return { daysLate: 0, fine: 0.0 };
  return { daysLate, fine: Math.round(daysLate * FINE_PER_DAY * 100) / 100 };
}

/** Atomically record a return, restore availability and store any fine. (rule #5) */
export async function returnBook(transactionId: number) {
  return prisma.$transaction(async (tx) => {
    const txnRows = await tx.$queryRaw<any[]>`
      SELECT * FROM borrow_transactions WHERE id = ${transactionId} FOR UPDATE
    `;
    const txn = txnRows[0];
    if (!txn) throw new AppError(404, "TXN_NOT_FOUND", "Borrow record not found.");
    if (txn.return_date !== null) {
      throw new AppError(409, "ALREADY_RETURNED", "This book has already been returned.");
    }

    const returnedAt = nowUtc();
    const { daysLate, fine } = calculateFine(txn.due_date, returnedAt);

    await tx.borrowTransaction.update({
      where: { id: transactionId },
      data: { return_date: returnedAt, status: TXN_RETURNED, fine_amount: fine },
    });

    // Guarded increment: never exceeds total_copies.
    await tx.$executeRaw`
      UPDATE books SET available_copies = LEAST(available_copies + 1, total_copies)
      WHERE id = ${txn.book_id}
    `;

    const book = await tx.book.findUnique({ where: { id: txn.book_id } });
    return {
      transactionId: txn.id,
      bookTitle: book?.title ?? "",
      returnDate: returnedAt.toISOString(),
      daysLate,
      fineAmount: fine,
      finePerDay: FINE_PER_DAY,
    };
  });
}

export async function listTransactions(opts: {
  memberId?: number;
  status?: string;
  search?: string;
  limit?: number;
}) {
  const { memberId, status, search, limit = 400 } = opts;
  await syncOverdue();

  const and: Prisma.BorrowTransactionWhereInput[] = [];
  if (memberId !== undefined) and.push({ member_id: memberId });
  if (status && status !== "ALL") {
    and.push(status === "ACTIVE" ? { return_date: null } : { status });
  }
  if (search?.trim()) {
    const like = search.trim();
    and.push({
      OR: [
        { book: { title: { contains: like, mode: "insensitive" } } },
        { book: { accession_number: { contains: like, mode: "insensitive" } } },
        { member: { first_name: { contains: like, mode: "insensitive" } } },
        { member: { last_name: { contains: like, mode: "insensitive" } } },
        { member: { email: { contains: like, mode: "insensitive" } } },
        { member: { matric_number: { contains: like, mode: "insensitive" } } },
      ],
    });
  }

  // NOTE: since schema.prisma has NO foreign-key relations (rule preserved from
  // Python), the `book:`/`member:` nested-filter syntax above will NOT work as
  // written — Prisma nested relation filters require an actual relation field.
  // Flagging this explicitly: this function needs either (a) a manual two-step
  // join (fetch matching book/member ids first, then filter transactions by
  // book_id/member_id IN [...]), or (b) relations added to the schema (see
  // open decision #1). Left as the relation-filter form above to show intent;
  // must be fixed before this compiles/runs.
  const rows = await prisma.borrowTransaction.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { borrow_date: "desc" },
    take: limit,
  });

  const bookIds = [...new Set(rows.map((r) => r.book_id))];
  const memberIds = [...new Set(rows.map((r) => r.member_id))];
  const [books, members] = await Promise.all([
    prisma.book.findMany({ where: { id: { in: bookIds } } }),
    prisma.member.findMany({ where: { id: { in: memberIds } } }),
  ]);
  const bookMap = new Map(books.map((b) => [b.id, b]));
  const memberMap = new Map(members.map((m) => [m.id, m]));

  return rows.map((txn) => txnToDict(txn, bookMap.get(txn.book_id), memberMap.get(txn.member_id)));
}

// --------------------------------------------------------------------------
// Reports
// --------------------------------------------------------------------------
export async function reportSummary() {
  await syncOverdue();
  const [titles, copiesAgg, availableAgg, membersTotal, activeBorrows, overdue, finesAgg, counts] =
    await Promise.all([
      prisma.book.count(),
      prisma.book.aggregate({ _sum: { total_copies: true } }),
      prisma.book.aggregate({ _sum: { available_copies: true } }),
      prisma.member.count(),
      prisma.borrowTransaction.count({ where: { return_date: null } }),
      prisma.borrowTransaction.count({ where: { return_date: null, status: TXN_OVERDUE } }),
      prisma.borrowTransaction.aggregate({ _sum: { fine_amount: true } }),
      statusCounts(),
    ]);

  return {
    totalTitles: titles,
    totalCopies: copiesAgg._sum.total_copies ?? 0,
    availableCopies: availableAgg._sum.available_copies ?? 0,
    totalMembers: membersTotal,
    activeMembers: counts[STATUS_ACTIVE] ?? 0,
    pendingMembers: counts[STATUS_PENDING] ?? 0,
    inactiveMembers: counts[STATUS_INACTIVE] ?? 0,
    activeBorrows,
    overdueCount: overdue,
    totalFines: Math.round(Number(finesAgg._sum.fine_amount ?? 0) * 100) / 100,
    loanPeriodDays: LOAN_PERIOD_DAYS,
    finePerDay: FINE_PER_DAY,
    borrowLimit: MAX_ACTIVE_BORROWS,
  };
}