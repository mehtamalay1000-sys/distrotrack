// ================================================================
// DistroTrack v2 — Stage 9B: Synchronization Engine Types
// File: src/lib/offline/sync/syncTypes.ts
// ================================================================

import type {
  OutboxEntry,
  OperationType,
  EntityType,
  OutboxStatus,
} from '../types.ts';

export type SyncErrorCode =
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'AUTHORIZATION_ERROR'
  | 'BUSINESS_VALIDATION_ERROR'
  | 'PAYLOAD_VALIDATION_ERROR'
  | 'UNSUPPORTED_OPERATION'
  | 'BLOCKED_MISSING_SERVER_RPC'
  | 'STALE_LEASE_RECOVERED'
  | 'CONCURRENCY_LOCKED'
  | 'UNKNOWN_ERROR';

export interface SyncStatus {
  isRunning: boolean;
  isProcessing: boolean;
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorAt: string | null;
  isOnline: boolean;
  hasAuthSession: boolean;
}

export interface SyncEntryResult {
  entryId: string;
  idempotencyKey: string;
  operationType: OperationType;
  entityType: EntityType;
  success: boolean;
  status: OutboxStatus;
  retryCount: number;
  nextRetryAt: string | null;
  error: {
    code: SyncErrorCode;
    message: string;
    retryable: boolean;
  } | null;
  idempotentServerMatch: boolean;
}

export interface SyncBatchResult {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  results: SyncEntryResult[];
  startedAt: string;
  completedAt: string;
}

export interface SyncEngineOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  processingTimeoutMs?: number;
  deterministicMode?: boolean;
  customSupabaseClient?: any;
  autoStartListeners?: boolean;
  pollIntervalMs?: number;
}

export type SyncStatusListener = (status: SyncStatus) => void;

export interface RpcDispatchResponse {
  success: boolean;
  data?: any;
  alreadyApplied?: boolean;
}

export type RpcDispatchHandler = (
  entry: OutboxEntry,
  client: any
) => Promise<RpcDispatchResponse>;
