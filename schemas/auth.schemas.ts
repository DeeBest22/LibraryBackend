import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string(), // platform sub (UUID), not auto-generated
  email: z.string(),
  name: z.string().optional(),
  role: z.string().default('user'), // 'user' | 'admin'
  last_login: z.string().datetime().optional(),
});

export const platformTokenExchangeRequestSchema = z.object({
  platform_token: z.string(),
});

export const tokenExchangeResponseSchema = z.object({
  token: z.string(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
export type PlatformTokenExchangeRequest = z.infer<typeof platformTokenExchangeRequestSchema>;
export type TokenExchangeResponse = z.infer<typeof tokenExchangeResponseSchema>;