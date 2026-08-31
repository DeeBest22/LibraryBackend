// src/telemetry/http.ts
import { currentRequest, recordPhase } from './timing.ts';

export async function observeExternalHttp<T>(operationPromise: Promise<T>): Promise<T> {
  if (!currentRequest()) {
    return operationPromise;
  }
  const startedNs = process.hrtime.bigint();
  try {
    return await operationPromise;
  } finally {
    try {
      recordPhase('external.http', Number(process.hrtime.bigint() - startedNs) / 1_000_000);
    } catch {
      /* preserve business exception */
    }
  }
}