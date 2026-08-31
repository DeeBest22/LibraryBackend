// src/types/express.d.ts
import { RequestState } from '../telemetry/timing';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name?: string; role: string };
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
export {};