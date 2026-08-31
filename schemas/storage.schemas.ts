import { z } from 'zod';

// Shared bucket_name field: rejects empty/whitespace-only input, then
// sanitizes by replacing every character that is NOT lowercase a-z or 0-9
// with '-' — operating on the ORIGINAL (untrimmed) string, so this also
// dashes-out whitespace and uppercase letters, not just symbols — then
// enforces a 3-63 length check on the SANITIZED result. Mirrors
// OSSBaseModel.validate_bucket_name's exact two-stage order.
const bucketNameField = z
  .string()
  .superRefine((v, ctx) => {
    if (!v || v.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bucket_name cannot be empty' });
    }
  })
  .transform((v) => v.replace(/[^a-z0-9]/g, '-'))
  .superRefine((v, ctx) => {
    if (v.length < 3 || v.length > 63) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bucket_name length should between 3 and 63' });
    }
  });

// object_key field for FileUpDownRequest ONLY — a different, less
// aggressive rule than bucket_name. Trims whitespace and rejects
// empty/255+ char keys, but does NOT alter casing or non-ASCII characters:
// presigned OSS URLs need the exact original key or downloads 404.
const validatedObjectKeyField = z
  .string()
  .superRefine((v, ctx) => {
    if (!v || v.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'object_key cannot be empty' });
    }
  })
  .transform((v) => v.trim())
  .superRefine((v, ctx) => {
    if (v.length > 255) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'object_key too long' });
    }
  });

export const bucketRequestSchema = z.object({
  bucket_name: bucketNameField,
  visibility: z.enum(['public', 'private']).default('public'),
});

export const bucketResponseSchema = bucketRequestSchema.extend({
  created_at: z.string().default(''),
});

export const objectInfoSchema = z.object({
  bucket_name: bucketNameField,
  object_key: z.string().default(''), // NOT the strict validator — matches source
  size: z.number().int().default(0),
  last_modified: z.string().default(''),
  etag: z.string().default(''),
});

export const objectListResponseSchema = z.object({
  objects: z.array(objectInfoSchema).default([]),
});

// BucketInfo(BucketRequest): pass — pure alias, no new fields.
export const bucketInfoSchema = bucketRequestSchema;

export const bucketListResponseSchema = z.object({
  buckets: z.array(bucketInfoSchema).default([]),
});

export const objectRequestSchema = z.object({
  bucket_name: bucketNameField,
  object_key: z.string().default(''), // unvalidated, matches source
});

export const fileUpDownRequestSchema = z.object({
  bucket_name: bucketNameField,
  object_key: validatedObjectKeyField,
});

export const fileUpDownResponseSchema = z.object({
  upload_url: z.string().default(''),
  download_url: z.string().default(''),
  expires_at: z.string(),
});

export const renameRequestSchema = z.object({
  bucket_name: bucketNameField,
  source_key: z.string().default(''), // unvalidated, matches source
  target_key: z.string().default(''), // unvalidated, matches source
  overwrite_key: z.boolean().default(true),
});

export const renameResponseSchema = z.object({
  success: z.boolean().default(false),
});

export const deleteResponseSchema = z.object({
  success: z.boolean().default(false),
});

export type BucketRequest = z.infer<typeof bucketRequestSchema>;
export type BucketResponse = z.infer<typeof bucketResponseSchema>;
export type ObjectInfo = z.infer<typeof objectInfoSchema>;
export type ObjectListResponse = z.infer<typeof objectListResponseSchema>;
export type BucketInfo = z.infer<typeof bucketInfoSchema>;
export type BucketListResponse = z.infer<typeof bucketListResponseSchema>;
export type ObjectRequest = z.infer<typeof objectRequestSchema>;
export type FileUpDownRequest = z.infer<typeof fileUpDownRequestSchema>;
export type FileUpDownResponse = z.infer<typeof fileUpDownResponseSchema>;
export type RenameRequest = z.infer<typeof renameRequestSchema>;
export type RenameResponse = z.infer<typeof renameResponseSchema>;
export type DeleteResponse = z.infer<typeof deleteResponseSchema>;