// Business constants ported from services/library.py

export const LOAN_PERIOD_DAYS = 14;
export const FINE_PER_DAY = 50.0; // NGN, fixed rate per day late
export const MAX_ACTIVE_BORROWS = 3;

export const ROLE_ADMIN = "ADMIN";
export const ROLE_USER = "USER";

export const STATUS_ACTIVE = "ACTIVE";
export const STATUS_INACTIVE = "INACTIVE";
export const STATUS_PENDING = "PENDING_APPROVAL";
export const MEMBER_STATUSES = [STATUS_ACTIVE, STATUS_INACTIVE, STATUS_PENDING] as const;

export const TXN_BORROWED = "BORROWED";
export const TXN_RETURNED = "RETURNED";
export const TXN_OVERDUE = "OVERDUE";
export const ACTIVE_TXN_STATUSES = [TXN_BORROWED, TXN_OVERDUE] as const;