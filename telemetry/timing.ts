// src/telemetry/timing.ts
import { AsyncLocalStorage } from 'node:async_hooks';

const PHASE_FIELDS: Record<string, string> = {
  initialization: 'initialization_ms',
  'init.services': 'init_services_ms',
  'init.app': 'init_app_ms',
  'init.service_imports': 'init_service_imports_ms',
  'db.query': 'db_query_total_ms',
  'external.http': 'external_http_total_ms',
};
const COUNTED_PHASES = new Set(['db.query', 'external.http']);

const als = new AsyncLocalStorage<RequestState>();

export interface RequestStateInit {
  startedNs: bigint;
  coldStart: boolean;
  httpMethod: string;
  httpRoute: string;
  urlPath: string;
  requestId: string | null;
  traceId: string | null;
  awsRequestId: string | null;
}

export class RequestState {
  startedNs: bigint;
  coldStart: boolean;
  httpMethod: string;
  httpRoute: string;
  urlPath: string;
  requestId: string | null;
  traceId: string | null;
  awsRequestId: string | null;
  statusCode: number | null = null;
  errorType: string | null = null;
  timingsMs: Record<string, number> = {};
  counts: Record<string, number> = {};
  initializationDepth = 0;

  constructor(init: RequestStateInit) {
    Object.assign(this, init);
  }
}

export function runWithRequestState<T>(state: RequestState, fn: () => T): T {
  return als.run(state, fn);
}

export function currentRequest(): RequestState | null {
  return als.getStore() ?? null;
}

export function recordPhase(name: string, durationMs: number): void {
  const state = currentRequest();
  if (!state || !(name in PHASE_FIELDS)) return;

  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration < 0) return;
  if (COUNTED_PHASES.has(name) && state.initializationDepth) return;

  state.timingsMs[name] = (state.timingsMs[name] ?? 0) + duration;
  if (COUNTED_PHASES.has(name)) {
    state.counts[name] = (state.counts[name] ?? 0) + 1;
  }
}

export async function measurePhase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const state = currentRequest();
  if (!state || !(name in PHASE_FIELDS)) {
    return fn();
  }

  const isInitialization = name === 'initialization' || name.startsWith('init.');
  if (isInitialization) state.initializationDepth += 1;

  const startedNs = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
    if (isInitialization) state.initializationDepth -= 1;
    recordPhase(name, elapsedMs);
  }
}

export function timedPhase<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R> | R,
): (...args: A) => Promise<R> {
  return (...args: A) => measurePhase(name, () => fn(...args));
}

export function timingFields(state: RequestState, durationMs: number): Record<string, number | boolean> {
  const result: Record<string, number | boolean> = {};
  for (const [phase, fieldName] of Object.entries(PHASE_FIELDS)) {
    result[fieldName] = round3(state.timingsMs[phase] ?? 0);
  }
  const handlerWallMs = Math.max(0, durationMs - (state.timingsMs.initialization ?? 0));
  result.handler_wall_ms = round3(handlerWallMs);
  result.db_query_count = state.counts['db.query'] ?? 0;
  result.external_http_count = state.counts['external.http'] ?? 0;

  const attributedTotalMs = (state.timingsMs['db.query'] ?? 0) + (state.timingsMs['external.http'] ?? 0);
  result.timing_overlap = attributedTotalMs > handlerWallMs;
  return result;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}