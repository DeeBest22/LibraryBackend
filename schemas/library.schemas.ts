// src/schemas/library.schemas.ts
import { z } from 'zod';

export const selfRegistrationSchema = z.object({
  first_name: z.string().min(2).max(100),
  last_name: z.string().min(2).max(100),
  matric_number: z.string().min(4).max(40),
  department: z.string().min(2).max(150),
  level: z.string().min(3).max(20),
});

export const bookPayloadSchema = z.object({
  title: z.string().min(2).max(300),
  author: z.string().min(2).max(200),
  accession_number: z.string().min(2).max(60),
  isbn: z.string().max(40).optional(),
  publisher: z.string().max(200).optional(),
  publication_year: z.number().int().min(1400).max(2100).optional(),
  category: z.string().max(100).optional(),
  total_copies: z.number().int().min(1).max(10000),
  cover_image_url: z.string().max(500).optional(),
});

export const memberPayloadSchema = z.object({
  email: z.string().email(),
  first_name: z.string().min(2).max(100),
  last_name: z.string().min(2).max(100),
  matric_number: z.string().max(40).optional(),
  department: z.string().max(150).optional(),
  level: z.string().max(20).optional(),
  role: z.string().default('user'), // default mirrors lib.ROLE_USER — finalize once services/library.ts defines it
});

export const memberUpdateSchema = z.object({
  email: z.string().email().optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  matric_number: z.string().max(40).optional(),
  department: z.string().max(150).optional(),
  level: z.string().max(20).optional(),
  status: z.string().optional(),
  role: z.string().optional(),
});

export const borrowRequestSchema = z.object({
  book_id: z.number().int(),
  member_id: z.number().int().optional(),
});

export const returnRequestSchema = z.object({
  transaction_id: z.number().int(),
});

export const bookQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  availability: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(60),
});

export const adminMembersQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
});

export const adminTransactionsQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
});