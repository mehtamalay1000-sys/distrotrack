/**
 * Authoritative React Query key registry for DistroTrack v2.
 *
 * ALL useQuery / useQueryClient.invalidateQueries calls must import keys
 * from this file. This ensures:
 *   1. Consistent cross-role cache invalidation (Admin mutation → Master update).
 *   2. No stale "dashboard-metrics" vs "dashboard-stats" fragmentation.
 *   3. Easy audit: every query key in one place.
 *
 * NEVER hardcode query keys inline — always use this registry.
 */
export const QK = {
  // ── Core business entities ────────────────────────────────────────
  workers: ['workers'] as const,
  routes: ['routes'] as const,
  picklists: ['picklists'] as const,
  deliveries: ['deliveries'] as const,
  payments: ['payments'] as const,
  expenses: ['expenses'] as const,
  parties: ['parties'] as const,
  products: ['products'] as const,
  inventory: ['inventory'] as const,

  // ── Admin Dashboard ───────────────────────────────────────────────
  /** Admin/shared dashboard stats (today + MTD financial summary). */
  dashboardStats: ['dashboard-stats'] as const,

  // ── Master KPIs (parameterised by date range) ─────────────────────
  /** Master financial KPIs for a given date range. */
  masterKpis: (from: string, to: string) => ['master-kpis', from, to] as const,
  masterKpisAny: ['master-kpis'] as const,

  /** Cross-period historical summaries for master reporting. */
  masterHistoricalSummaries: ['master-historical-summaries'] as const,

  /** Live operations overview (active routes, delivery progress). */
  masterOperations: ['master-operations'] as const,

  /** Per-worker monitor data (deliveries, payments, route history). */
  masterWorkerMonitor: (workerId: string) => ['master-worker-monitor', workerId] as const,

  /** All workers list (for monitor grid). */
  masterAllWorkers: ['master-all-workers'] as const,

  /** Exceptions deck (cash discrepancies, bounced cheques, etc.). */
  masterExceptions: (from: string, to: string) => ['master-exceptions', from, to] as const,
  masterExceptionsAny: ['master-exceptions'] as const,

  /** Audit log. */
  masterAuditLog: (from: string, to: string) => ['master-audit-log', from, to] as const,
  masterAuditLogAny: ['master-audit-log'] as const,

  /** Inventory deep-dive (all products + movements + vehicles). */
  masterInventory: ['master-inventory'] as const,

  /** Product analytics (delivery quantities by SKU). */
  masterProductAnalytics: (from: string, to: string) => ['master-product-analytics', from, to] as const,

  /** Party debt aging. */
  masterPartyAging: ['master-party-aging'] as const,

  /** SAP imports overview (purchases + sales). */
  masterSapImports: ['master-sap-imports'] as const,

  /** System health probe. */
  masterSystemHealth: ['master-system-health'] as const,

  /** Route profitability. */
  masterRouteProfitability: (from: string, to: string) => ['master-route-profitability', from, to] as const,

  // ── Worker-scoped ─────────────────────────────────────────────────
  /** Today's active route for a specific worker. */
  workerTodayRoute: (workerId: string) => ['worker-today-route', workerId] as const,
  workerTodayRouteAny: ['worker-today-route'] as const,

  /** Deliveries for the worker's current route. */
  workerRouteDeliveries: (workerId: string) => ['worker-route-deliveries', workerId] as const,

  /** Worker payment history. */
  workerPayments: (workerId: string) => ['worker-payments', workerId] as const,

  /** Worker expense records. */
  workerExpenses: (workerId: string) => ['worker-expenses', workerId] as const,

  /** Worker performance metrics (MTD). */
  workerMetrics: (workerId: string) => ['worker-performance-metrics', workerId] as const,

  /** Worker recent completed routes. */
  workerRecentRoutes: (workerId: string) => ['worker-recent-routes', workerId] as const,

  /** Delivery detail (single delivery). */
  deliveryDetail: (deliveryId: string) => ['delivery-detail', deliveryId] as const,

  /** Worker history. */
  workerHistory: (workerId: string) => ['worker-history', workerId] as const,

  // ── SAP / Import ──────────────────────────────────────────────────
  sapSalesImports: ['sap-sales-imports'] as const,
  sapPurchaseImports: ['sap-purchase-imports'] as const,
  sapPicklistImports: ['sap-picklist-imports'] as const,
  unmappedSkus: ['unmapped-skus'] as const,

  /** Pending credit deliveries (Admin/Master collection queue). */
  pendingCollections: ['pending-collections'] as const,
} as const;

/**
 * Helper: returns ALL master query key prefixes.
 * Use when you want to broadly invalidate everything Master reads
 * (e.g., after a full inventory reset). In most cases prefer specific keys.
 */
export const MASTER_QUERY_KEYS = [
  QK.masterOperations,
  QK.masterAllWorkers,
  QK.masterInventory,
  QK.masterSapImports,
  QK.masterSystemHealth,
  QK.masterPartyAging,
] as const;
