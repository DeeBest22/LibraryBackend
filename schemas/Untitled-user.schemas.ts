// src/schemas/user.schemas.ts
import { z } from 'zod';

// Mirrors user.service.ts's updateUserProfile — name is the only editable field.
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;