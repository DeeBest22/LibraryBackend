// src/telemetry/prisma-timing.ts
import { Prisma } from '../generated/prisma/client';
import { currentRequest, recordPhase } from './timing.ts';

export function queryTimingExtension() {
  return Prisma.defineExtension({
    name: 'funcsea-query-timing',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          if (!currentRequest()) {
            return query(args);
          }
          const startedNs = process.hrtime.bigint();
          try {
            return await query(args);
          } finally {
            try {
              recordPhase('db.query', Number(process.hrtime.bigint() - startedNs) / 1_000_000);
            } catch {
              /* query result wins */
            }
          }
        },
      },
    },
  });
}