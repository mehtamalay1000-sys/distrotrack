// ================================================================
// DistroTrack v2 — Stage 9B: Synchronization Error Hierarchy & Classification
// File: src/lib/offline/sync/syncErrors.ts
// ================================================================

import type { SyncErrorCode } from './syncTypes.ts';

export class SyncError extends Error {
  public readonly code: SyncErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly originalError?: unknown;

  constructor(
    message: string,
    code: SyncErrorCode,
    retryable: boolean,
    statusCode?: number,
    originalError?: unknown
  ) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.originalError = originalError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkSyncError extends SyncError {
  constructor(message = 'Network connectivity or transient server error', originalError?: unknown, statusCode?: number) {
    super(message, 'NETWORK_ERROR', true, statusCode, originalError);
    this.name = 'NetworkSyncError';
  }
}

export class RateLimitSyncError extends SyncError {
  public readonly retryAfterSeconds?: number;

  constructor(message = 'Rate limit exceeded (HTTP 429)', retryAfterSeconds?: number, originalError?: unknown) {
    super(message, 'RATE_LIMITED', true, 429, originalError);
    this.name = 'RateLimitSyncError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AuthRequiredSyncError extends SyncError {
  constructor(message = 'Authenticated Supabase session is required before synchronization', originalError?: unknown) {
    // AuthRequired is considered non-permanent; the mutation is preserved in pending state
    super(message, 'AUTH_REQUIRED', true, 401, originalError);
    this.name = 'AuthRequiredSyncError';
  }
}

export class AuthorizationSyncError extends SyncError {
  constructor(message = 'Operation rejected due to authorization policy or role restriction', originalError?: unknown, statusCode = 403) {
    super(message, 'AUTHORIZATION_ERROR', false, statusCode, originalError);
    this.name = 'AuthorizationSyncError';
  }
}

export class BusinessValidationSyncError extends SyncError {
  constructor(message = 'Operation failed server-side business rules or inventory validation', originalError?: unknown, statusCode = 400) {
    super(message, 'BUSINESS_VALIDATION_ERROR', false, statusCode, originalError);
    this.name = 'BusinessValidationSyncError';
  }
}

export class PayloadValidationSyncError extends SyncError {
  constructor(message = 'Outbox payload structure is malformed or missing required identifiers', originalError?: unknown) {
    super(message, 'PAYLOAD_VALIDATION_ERROR', false, 422, originalError);
    this.name = 'PayloadValidationSyncError';
  }
}

export class UnsupportedOperationSyncError extends SyncError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'UNSUPPORTED_OPERATION', false, 400, originalError);
    this.name = 'UnsupportedOperationSyncError';
  }
}

export class BlockedMissingServerRpcSyncError extends SyncError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'BLOCKED_MISSING_SERVER_RPC', false, 501, originalError);
    this.name = 'BlockedMissingServerRpcSyncError';
  }
}

/**
 * Classify raw Supabase, PostgREST, or network errors into strongly-typed SyncErrors.
 */
export function classifySupabaseError(error: any): SyncError {
  if (!error) {
    return new SyncError('Unknown synchronization error', 'UNKNOWN_ERROR', false);
  }

  if (error instanceof SyncError) {
    return error;
  }

  const message = String(error.message || error.error_description || error || 'Unknown error');
  const lowerMsg = message.toLowerCase();
  const code = String(error.code || error.status || '').toUpperCase();
  const status = Number(error.status || error.statusCode || 0);

  // 1. Rate Limit (HTTP 429)
  if (status === 429 || code === '429' || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests')) {
    return new RateLimitSyncError(message, error.retryAfter ? Number(error.retryAfter) : undefined, error);
  }

  // 2. Network connectivity / Offline / Transient server errors
  if (
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('network request failed') ||
    lowerMsg.includes('network error') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('gateway timeout') ||
    lowerMsg.includes('bad gateway') ||
    lowerMsg.includes('service unavailable') ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === '502' ||
    code === '503' ||
    code === '504'
  ) {
    return new NetworkSyncError(message, error, status || 503);
  }

  // 3. Authentication issues
  if (
    lowerMsg.includes('jwt expired') ||
    lowerMsg.includes('invalid jwt') ||
    lowerMsg.includes('auth session missing') ||
    lowerMsg.includes('no authenticated session') ||
    lowerMsg.includes('not logged in')
  ) {
    return new AuthRequiredSyncError(message, error);
  }

  // 4. Authorization / Permission Denied (Postgres 42501 or HTTP 403 / 401)
  if (
    code === '42501' ||
    status === 403 ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('violates row-level security policy') ||
    lowerMsg.includes('not assigned to') ||
    lowerMsg.includes('not authorized')
  ) {
    return new AuthorizationSyncError(message, error, status || 403);
  }

  // 5. Business logic & constraint failures
  if (
    status === 400 ||
    status === 422 ||
    lowerMsg.includes('insufficient stock') ||
    lowerMsg.includes('already completed') ||
    lowerMsg.includes('already closed') ||
    lowerMsg.includes('already finalized') ||
    lowerMsg.includes('item count mismatch') ||
    lowerMsg.includes('invalid payment mode') ||
    lowerMsg.includes('amount must be greater than zero') ||
    lowerMsg.includes('violates check constraint') ||
    lowerMsg.includes('foreign key constraint')
  ) {
    return new BusinessValidationSyncError(message, error, status || 400);
  }

  // 6. Generic fallback
  return new SyncError(message, 'UNKNOWN_ERROR', false, status, error);
}
