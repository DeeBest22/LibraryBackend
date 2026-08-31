// src/telemetry/request-summary.ts
import { RequestState, timingFields } from './timing.ts';

const FUNCTION_IDENTITY = /-app-([0-9a-fA-F]{32})-(dev|prod)(?:-(v[0-9]+))?$/;
const TRACEPARENT = /^[0-9a-fA-F]{2}-([0-9a-fA-F]{32})-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}$/;
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

let coldStart = true;

function isEnabled(): boolean {
  const configured =
    process.env.FUNCSEA_TELEMETRY_ENABLED ?? process.env.FUNCSEA_REQUEST_SUMMARY_ENABLED ?? 'true';
  return !FALSE_VALUES.has(configured.trim().toLowerCase());
}

function safeCorrelation(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 128) return null;
  for (const ch of normalized) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code === 127) return null;
  }
  return normalized;
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries((headers as Record<string, unknown>) ?? {})) {
    if (value !== null && value !== undefined) {
      result[String(key).toLowerCase()] = String(value);
    }
  }
  return result;
}

function traceId(headers: Record<string, string>): string | null {
  const traceparent = (headers.traceparent ?? '').split(',', 1)[0].trim();
  const match = TRACEPARENT.exec(traceparent);
  if (match && match[1] !== '0'.repeat(32)) {
    return match[1].toLowerCase();
  }
  return safeCorrelation(headers['x-trace-id'] ?? headers['trace-id']);
}

function isExcluded(method: string, path: string): boolean {
  return method.toUpperCase() === 'OPTIONS' || !path.startsWith('/api/v1/');
}

function boundedText(value: unknown, limit: number): string {
  return String(value).slice(0, limit);
}

function serviceAttributes(): Record<string, string> {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME ?? '';
  const attributes: Record<string, string> = {
    function_name: functionName,
    app_id: process.env.FUNCSEA_APP_ID ?? process.env.OIDC_CLIENT_ID ?? '',
    environment: process.env.FUNCSEA_ENVIRONMENT ?? process.env.ENVIRONMENT ?? '',
    service_version: process.env.FUNCSEA_SERVICE_VERSION ?? '',
  };
  const identity = FUNCTION_IDENTITY.exec(functionName);
  if (identity) {
    attributes.app_id ||= identity[1].toLowerCase();
    attributes.environment ||= identity[2];
    attributes.service_version ||= identity[3] || 'latest';
  }
  return attributes;
}

function emit(summary: Record<string, unknown>): void {
  try {
    process.stdout.write(JSON.stringify(summary) + '\n');
  } catch {
    /* fail-open */
  }
}

export interface StartRequestArgs {
  method: string;
  path: string;
  route: string;
  headers: unknown;
  awsRequestId?: unknown;
  requestIdFallback?: unknown;
}

export function startRequest(args: StartRequestArgs): RequestState | null {
  const isColdStart = coldStart;
  coldStart = false;

  if (!isEnabled()) return null;
  if (isExcluded(args.method, args.path)) return null;

  const normalizedHeaders = normalizeHeaders(args.headers);
  return new RequestState({
    startedNs: process.hrtime.bigint(),
    coldStart: isColdStart,
    httpMethod: boundedText(args.method, 16),
    httpRoute: boundedText(args.route, 512),
    urlPath: boundedText(args.path, 2048),
    requestId: safeCorrelation(
      normalizedHeaders['x-kong-request-id'] ?? normalizedHeaders['x-request-id'] ?? args.requestIdFallback,
    ),
    traceId: traceId(normalizedHeaders),
    awsRequestId: safeCorrelation(args.awsRequestId),
  });
}

export function finishRequest(
  state: RequestState,
  { statusCode = null, errorType = null }: { statusCode?: number | null; errorType?: string | null } = {},
): void {
  const durationMs = Number(process.hrtime.bigint() - state.startedNs) / 1_000_000;
  state.statusCode = statusCode ?? state.statusCode;
  state.errorType = errorType ?? state.errorType;

  try {
    const summary: Record<string, unknown> = {
      event_name: 'funcsea.request.summary',
      schema_version: 1,
      ...serviceAttributes(),
      request_id: state.requestId,
      trace_id: state.traceId,
      aws_request_id: state.awsRequestId,
      http_method: state.httpMethod,
      http_route: state.httpRoute,
      url_path: state.urlPath,
      status_code: state.statusCode,
      duration_ms: Math.round(durationMs * 1000) / 1000,
      cold_start: state.coldStart,
      backend_initialized_this_request: Boolean(state.timingsMs.initialization),
      ...timingFields(state, durationMs),
    };
    if (state.errorType) summary.error_type = state.errorType;
    emit(summary);
  } catch {
    /* fail-open */
  }
}